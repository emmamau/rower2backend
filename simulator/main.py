import os
import sys
from typing import Dict, List, Optional, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

from store import SimulatorStore
from engine import SimulationEngine
from test_users_seeder import seed_and_pair_test_users

store = SimulatorStore(count=30, filepath="simulator/virtual_watches.json")
engine = SimulationEngine(store)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await engine.init_session()
    print("\n=======================================================")
    print("  SIMULATEUR DE CHARGE GARMIN FTMS (30 MONTRES)")
    print(f"  Dashboard Web actif sur : http://localhost:8080")
    print(f"  Backend cible           : {store.backend_url}")
    print("=======================================================\n")
    yield
    # Shutdown
    await engine.stop_all()
    await engine.close_session()

app = FastAPI(title="Garmin FTMS Load Simulator", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request Models
class BackendUrlRequest(BaseModel):
    backend_url: str

class LoadTestKeyRequest(BaseModel):
    load_test_key: str

class SpoofSignatureRequest(BaseModel):
    spoof_garmin_signature: bool

class SyncConfigRequest(BaseModel):
    auto_sync_on_engage: Optional[bool] = None
    first_stroke_auto_delay_sec: Optional[float] = None

class PinRequest(BaseModel):
    pin: str
    auto_arm: Optional[bool] = None

class AutoEngageWatchRequest(BaseModel):
    target_race: Optional[str] = None
    fallback_public: Optional[bool] = False
    auto_arm: Optional[bool] = None

class PaceRequest(BaseModel):
    split_sec: Optional[float] = None
    power_watts: Optional[int] = None
    delta_watts: Optional[int] = None

class FleetEnableRequest(BaseModel):
    count: Optional[int] = None
    enabled: Optional[bool] = None

class SeedUsersRequest(BaseModel):
    count: Optional[int] = 30
    password: Optional[str] = "RowerTest2026!"
    prefix: Optional[str] = "test_runner_"
    only_enabled: Optional[bool] = False

class BulkEngageRequest(BaseModel):
    watch_ids: List[int]
    pin: str
    auto_arm: Optional[bool] = None

class BulkDistributeRequest(BaseModel):
    watch_ids: List[int]
    targets: List[str]
    mode: Optional[str] = "round_robin"  # "round_robin" or "sequential"
    auto_arm: Optional[bool] = None

class BulkAutoEngageEnrolledRequest(BaseModel):
    watch_ids: Optional[List[int]] = None
    fallback_public: Optional[bool] = False
    auto_arm: Optional[bool] = None

class BulkJoinPublicRequest(BaseModel):
    watch_ids: List[int]
    auto_arm: Optional[bool] = None

class BulkPaceRequest(BaseModel):
    watch_ids: Optional[List[int]] = None
    race_id: Optional[str] = None
    profile: Optional[str] = None
    split_sec: Optional[float] = None

class BulkActionRequest(BaseModel):
    watch_ids: Optional[List[int]] = None
    race_id: Optional[str] = None
    clear_assignment: Optional[bool] = False

@app.get("/", response_class=HTMLResponse)
async def serve_dashboard():
    html_path = os.path.join(os.path.dirname(__file__), "templates", "index.html")
    if os.path.exists(html_path):
        with open(html_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse("<h1>Templates introuvable</h1>", status_code=404)

@app.get("/api/state")
async def get_state():
    return {
        "backend_url": store.backend_url,
        "load_test_key": store.load_test_key,
        "spoof_garmin_signature": store.spoof_garmin_signature,
        "auto_sync_on_engage": store.auto_sync_on_engage,
        "first_stroke_auto_delay_sec": store.first_stroke_auto_delay_sec,
        "metrics": engine.metrics.get_stats(),
        "active_races": engine.get_active_races_summary(),
        "watches": [w.to_dict() for w in store.get_all_watches()],
    }

@app.post("/api/config/backend-url")
async def update_backend_url(req: BackendUrlRequest):
    store.backend_url = req.backend_url.rstrip("/")
    store.save()
    return {"success": True, "backend_url": store.backend_url}

@app.post("/api/config/load-test-key")
async def update_load_test_key(req: LoadTestKeyRequest):
    store.load_test_key = req.load_test_key.strip()
    store.save()
    return {"success": True, "load_test_key": store.load_test_key}

@app.post("/api/config/spoof-signature")
async def update_spoof_signature(req: SpoofSignatureRequest):
    store.spoof_garmin_signature = req.spoof_garmin_signature
    store.save()
    return {"success": True, "spoof_garmin_signature": store.spoof_garmin_signature}

@app.post("/api/config/sync")
async def update_sync_config(req: SyncConfigRequest):
    if req.auto_sync_on_engage is not None:
        store.auto_sync_on_engage = bool(req.auto_sync_on_engage)
    if req.first_stroke_auto_delay_sec is not None:
        store.first_stroke_auto_delay_sec = max(0.0, min(60.0, float(req.first_stroke_auto_delay_sec)))
    store.save()
    return {
        "success": True,
        "auto_sync_on_engage": store.auto_sync_on_engage,
        "first_stroke_auto_delay_sec": store.first_stroke_auto_delay_sec,
    }

@app.post("/api/watches/{watch_id}/pair")
async def pair_watch(watch_id: int, req: PinRequest):
    res = await engine.pair_watch_pin(watch_id, req.pin)
    return res

@app.post("/api/watches/{watch_id}/engage")
async def engage_watch(watch_id: int, req: PinRequest):
    res = await engine.claim_race_pin(watch_id, req.pin, auto_arm=req.auto_arm)
    return res

@app.post("/api/watches/{watch_id}/join-public")
async def join_public(watch_id: int):
    res = await engine.join_public_race(watch_id)
    return res

@app.get("/api/watches/{watch_id}/enrolled-races")
async def get_watch_enrolled_races(watch_id: int):
    res = await engine.fetch_user_enrolled_races(watch_id)
    return res

@app.post("/api/watches/{watch_id}/auto-engage")
async def auto_engage_watch(watch_id: int, req: Optional[AutoEngageWatchRequest] = None):
    target_race = req.target_race if req else None
    fallback_public = bool(req.fallback_public) if req and req.fallback_public is not None else False
    auto_arm = req.auto_arm if req else None
    res = await engine.auto_engage_watch_enrolled(
        watch_id,
        target_race_id_or_pin=target_race,
        fallback_public=fallback_public,
        auto_arm=auto_arm,
    )
    return res

@app.post("/api/watches/{watch_id}/first-stroke")
async def trigger_watch_first_stroke(watch_id: int):
    res = await engine.trigger_first_stroke_for_race(watch_ids=[watch_id])
    return res

@app.post("/api/watches/{watch_id}/toggle-enabled")
async def toggle_watch_enabled(watch_id: int):
    new_state = store.toggle_watch_enabled(watch_id)
    if not new_state:
        await engine.stop_watch_simulation(watch_id)
    return {"success": True, "watch_id": watch_id, "is_enabled": new_state}

@app.post("/api/bulk/enable-fleet")
async def bulk_enable_fleet(req: FleetEnableRequest):
    if req.count is not None:
        store.set_fleet_enabled_count(req.count)
    elif req.enabled is not None:
        store.set_all_enabled(req.enabled)
    for w in store.watches.values():
        if not w.is_enabled and w.id in engine.watch_tasks:
            await engine.stop_watch_simulation(w.id)
    return {"success": True, "enabled_count": len(store.get_enabled_watches())}

@app.post("/api/watches/{watch_id}/pace")
async def set_watch_pace(watch_id: int, req: PaceRequest):
    watch = store.get_watch(watch_id)
    if not watch:
        raise HTTPException(status_code=404, detail="Montre introuvable")
    if req.delta_watts is not None:
        new_power = max(50, min(1000, watch.target_power + req.delta_watts))
        watch.set_power(new_power)
    elif req.split_sec is not None:
        watch.set_pace(req.split_sec)
    elif req.power_watts is not None:
        watch.set_power(req.power_watts)
    store.save()
    return {"success": True, "watch": watch.to_dict()}

@app.post("/api/bulk/engage")
async def bulk_engage(req: BulkEngageRequest):
    # Support comma/space separated PINs directly through bulk_engage as well!
    raw_targets = [t.strip() for t in req.pin.replace(";", ",").split(",") if t.strip()]
    if len(raw_targets) > 1:
        return await engine.distribute_watches_across_races(
            watch_ids=req.watch_ids,
            race_targets=raw_targets,
            mode="round_robin",
            auto_arm=req.auto_arm,
        )

    count = 0
    errors = []
    active_ids = [wid for wid in req.watch_ids if store.get_watch(wid) and store.get_watch(wid).is_enabled]
    for wid in active_ids:
        res = await engine.claim_race_pin(wid, req.pin, auto_arm=req.auto_arm)
        if res.get("success"):
            count += 1
        else:
            errors.append(f"#{wid}: {res.get('message')}")
    return {
        "success": count > 0,
        "engaged_count": count,
        "total": len(active_ids),
        "message": f"{count} / {len(active_ids)} kayaks actifs engagés avec le code {req.pin}",
        "errors": errors[:5]
    }

@app.post("/api/bulk/distribute")
async def bulk_distribute(req: BulkDistributeRequest):
    res = await engine.distribute_watches_across_races(
        watch_ids=req.watch_ids,
        race_targets=req.targets,
        mode=req.mode or "round_robin",
        auto_arm=req.auto_arm,
    )
    return res

@app.post("/api/bulk/auto-engage-enrolled")
async def bulk_auto_engage_enrolled(req: BulkAutoEngageEnrolledRequest):
    if req.watch_ids:
        active_ids = [wid for wid in req.watch_ids if store.get_watch(wid) and store.get_watch(wid).is_enabled]
    else:
        active_ids = [w.id for w in store.get_enabled_watches()]

    engaged_count = 0
    enrolled_found_count = 0
    fallback_count = 0
    errors = []
    by_race: Dict[str, int] = {}

    for wid in active_ids:
        res = await engine.auto_engage_watch_enrolled(
            wid,
            target_race_id_or_pin=None,
            fallback_public=bool(req.fallback_public),
            auto_arm=req.auto_arm,
        )
        if res.get("enrolled_count", 0) > 0:
            enrolled_found_count += 1
        if res.get("success"):
            engaged_count += 1
            if res.get("fallback_public"):
                fallback_count += 1
            w = store.get_watch(wid)
            r_label = (w.race_pin or w.race_id or "COURSE") if w else "COURSE"
            by_race[r_label] = by_race.get(r_label, 0) + 1
        else:
            errors.append(f"#{wid}: {res.get('message')}")

    breakdown = " • ".join([f"{k}: {v}" for k, v in by_race.items()])
    msg = f"{engaged_count}/{len(active_ids)} kayaks engagés automatiquement ({enrolled_found_count} inscrits trouvés"
    if fallback_count > 0:
        msg += f", {fallback_count} sur course publique"
    msg += f")"
    if breakdown:
        msg += f" [{breakdown}]"

    return {
        "success": engaged_count > 0,
        "engaged_count": engaged_count,
        "enrolled_found_count": enrolled_found_count,
        "fallback_count": fallback_count,
        "total": len(active_ids),
        "by_race": by_race,
        "errors": errors[:5],
        "message": msg,
    }

@app.post("/api/bulk/scan-enrolled")
async def bulk_scan_enrolled(req: BulkActionRequest):
    if req.watch_ids:
        active_ids = [wid for wid in req.watch_ids if store.get_watch(wid) and store.get_watch(wid).is_enabled]
    else:
        active_ids = [w.id for w in store.get_enabled_watches()]

    found_watches = 0
    total_courses = 0
    for wid in active_ids:
        res = await engine.fetch_user_enrolled_races(wid)
        cnt = res.get("count", 0)
        if cnt > 0:
            found_watches += 1
            total_courses += cnt

    return {
        "success": True,
        "found_watches": found_watches,
        "total_courses": total_courses,
        "message": f"Scan terminé : {found_watches} joueur(s) virtuel(s) ont des courses inscrites ({total_courses} inscriptions au total)."
    }

@app.post("/api/bulk/join-public")
async def bulk_join_public(req: BulkJoinPublicRequest):
    count = 0
    active_ids = [wid for wid in req.watch_ids if store.get_watch(wid) and store.get_watch(wid).is_enabled]
    for wid in active_ids:
        res = await engine.join_public_race(wid, auto_arm=req.auto_arm)
        if res.get("success"):
            count += 1
    return {
        "success": True,
        "joined_count": count,
        "message": f"{count} kayaks actifs engagés et synchronisés sur la course publique !"
    }

@app.post("/api/bulk/pace")
async def bulk_set_pace(req: BulkPaceRequest):
    if req.race_id:
        targets = [w.id for w in store.get_watches_for_race(req.race_id)]
    elif req.watch_ids:
        targets = req.watch_ids
    else:
        targets = [w.id for w in store.get_enabled_watches()]

    if req.profile:
        if req.profile == "peloton" and len(targets) > 1:
            # Distribute peloton pace across the target subset
            for idx, wid in enumerate(targets):
                w = store.get_watch(wid)
                if w:
                    ratio = idx / max(1, len(targets) - 1)
                    split = 98.0 + (142.0 - 98.0) * ratio
                    w.set_pace(split)
            store.save()
        else:
            for wid in targets:
                store.apply_profile(wid, req.profile)
    elif req.split_sec is not None:
        for wid in targets:
            w = store.get_watch(wid)
            if w:
                w.set_pace(req.split_sec)
        store.save()
    return {"success": True, "message": f"Allures mises à jour pour {len(targets)} kayak(s)"}

@app.post("/api/bulk/start")
async def bulk_start(req: BulkActionRequest):
    await engine.start_all(watch_ids=req.watch_ids, race_id=req.race_id)
    return {"success": True, "message": "Synchronisation & télémétrie démarrées"}

@app.post("/api/bulk/first-stroke")
async def bulk_first_stroke(req: BulkActionRequest):
    res = await engine.trigger_first_stroke_for_race(race_id=req.race_id, watch_ids=req.watch_ids)
    return res

@app.post("/api/bulk/stop")
async def bulk_stop(req: Optional[BulkActionRequest] = None):
    watch_ids = req.watch_ids if req else None
    race_id = req.race_id if req else None
    await engine.stop_all(watch_ids=watch_ids, race_id=race_id)
    return {"success": True, "message": "Simulation stoppée"}

@app.post("/api/bulk/reset")
async def bulk_reset(req: BulkActionRequest):
    await engine.reset_all(
        watch_ids=req.watch_ids,
        race_id=req.race_id,
        clear_assignment=bool(req.clear_assignment),
    )
    return {"success": True, "message": "Distances réinitialisées"}

@app.post("/api/seed-users")
async def seed_users(req: Optional[SeedUsersRequest] = None):
    count = req.count if req and req.count else 30
    password = req.password if req and req.password else "RowerTest2026!"
    prefix = req.prefix if req and req.prefix else "test_runner_"
    only_enabled = req.only_enabled if req and req.only_enabled else False
    res = await seed_and_pair_test_users(
        store,
        count=count,
        common_password=password,
        login_prefix=prefix,
        only_enabled=only_enabled
    )
    return res

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8080, reload=False)
