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

class PinRequest(BaseModel):
    pin: str

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

class BulkJoinPublicRequest(BaseModel):
    watch_ids: List[int]

class BulkPaceRequest(BaseModel):
    watch_ids: List[int]
    profile: Optional[str] = None
    split_sec: Optional[float] = None

class BulkActionRequest(BaseModel):
    watch_ids: Optional[List[int]] = None

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
        "metrics": engine.metrics.get_stats(),
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

@app.post("/api/watches/{watch_id}/pair")
async def pair_watch(watch_id: int, req: PinRequest):
    res = await engine.pair_watch_pin(watch_id, req.pin)
    return res

@app.post("/api/watches/{watch_id}/engage")
async def engage_watch(watch_id: int, req: PinRequest):
    res = await engine.claim_race_pin(watch_id, req.pin)
    return res

@app.post("/api/watches/{watch_id}/join-public")
async def join_public(watch_id: int):
    res = await engine.join_public_race(watch_id)
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
    count = 0
    errors = []
    # Only engage enabled watches among selection
    active_ids = [wid for wid in req.watch_ids if store.get_watch(wid) and store.get_watch(wid).is_enabled]
    for wid in active_ids:
        res = await engine.claim_race_pin(wid, req.pin)
        if res.get("success"):
            count += 1
        else:
            errors.append(f"#{wid}: {res.get('message')}")
    return {
        "success": count > 0,
        "engaged_count": count,
        "total": len(active_ids),
        "message": f"{count} / {len(active_ids)} kayaks actifs engagés avec le code PIN {req.pin}",
        "errors": errors[:5]
    }

@app.post("/api/bulk/join-public")
async def bulk_join_public(req: BulkJoinPublicRequest):
    count = 0
    active_ids = [wid for wid in req.watch_ids if store.get_watch(wid) and store.get_watch(wid).is_enabled]
    for wid in active_ids:
        res = await engine.join_public_race(wid)
        if res.get("success"):
            count += 1
    return {
        "success": True,
        "joined_count": count,
        "message": f"{count} kayaks actifs engagés sur la course publique !"
    }

@app.post("/api/bulk/pace")
async def bulk_set_pace(req: BulkPaceRequest):
    if req.profile:
        for wid in req.watch_ids:
            store.apply_profile(wid, req.profile)
    elif req.split_sec is not None:
        for wid in req.watch_ids:
            w = store.get_watch(wid)
            if w:
                w.set_pace(req.split_sec)
        store.save()
    return {"success": True, "message": "Allures mises à jour pour la sélection"}

@app.post("/api/bulk/start")
async def bulk_start(req: BulkActionRequest):
    await engine.start_all(req.watch_ids)
    return {"success": True, "message": "Simulation télémétrique démarrée sur les kayaks actifs"}

@app.post("/api/bulk/stop")
async def bulk_stop():
    await engine.stop_all()
    return {"success": True, "message": "Simulation stoppée"}

@app.post("/api/bulk/reset")
async def bulk_reset(req: BulkActionRequest):
    await engine.reset_all(req.watch_ids)
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
