import asyncio
import collections
import math
import random
import time
from typing import Dict, List, Optional, Any
import aiohttp

from store import SimulatorStore, VirtualWatch

class MetricsCollector:
    def __init__(self, window_seconds: float = 3.0):
        self.window_seconds = window_seconds
        self.request_timestamps: collections.deque = collections.deque()
        self.latencies_ms: collections.deque = collections.deque(maxlen=500)
        self.status_counts: Dict[int, int] = collections.defaultdict(int)
        self.total_requests: int = 0
        self.total_errors: int = 0

    def record_request(self, status_code: int, latency_ms: float):
        now = time.time()
        self.request_timestamps.append(now)
        self.latencies_ms.append(latency_ms)
        self.status_counts[status_code] += 1
        self.total_requests += 1
        if status_code >= 400:
            self.total_errors += 1

    def get_stats(self) -> Dict[str, Any]:
        now = time.time()
        # Clean timestamps older than window
        while self.request_timestamps and now - self.request_timestamps[0] > self.window_seconds:
            self.request_timestamps.popleft()

        throughput = len(self.request_timestamps) / max(0.5, self.window_seconds)

        if self.latencies_ms:
            sorted_lat = sorted(self.latencies_ms)
            p95_idx = int(len(sorted_lat) * 0.95)
            p95 = sorted_lat[min(p95_idx, len(sorted_lat) - 1)]
            avg_lat = sum(self.latencies_ms) / len(self.latencies_ms)
            min_lat = sorted_lat[0]
            max_lat = sorted_lat[-1]
        else:
            p95 = avg_lat = min_lat = max_lat = 0.0

        return {
            "throughput_rps": round(throughput, 1),
            "rtt_avg_ms": round(avg_lat, 1),
            "rtt_p95_ms": round(p95, 1),
            "rtt_min_ms": round(min_lat, 1),
            "rtt_max_ms": round(max_lat, 1),
            "total_requests": self.total_requests,
            "total_errors": self.total_errors,
            "status_200": self.status_counts.get(200, 0) + self.status_counts.get(201, 0),
            "status_429": self.status_counts.get(429, 0),
            "status_500": self.status_counts.get(500, 0),
            "status_other": sum(v for k, v in self.status_counts.items() if k not in (200, 201, 429, 500)),
        }

class SimulationEngine:
    def __init__(self, store: SimulatorStore):
        self.store = store
        self.metrics = MetricsCollector()
        self.session: Optional[aiohttp.ClientSession] = None
        self.running: bool = False
        self.watch_tasks: Dict[int, asyncio.Task] = {}
        self.race_status_cache: Dict[str, Dict[str, Any]] = {}
        self._loop_lock = asyncio.Lock()

    async def init_session(self):
        if self.session is None or self.session.closed:
            timeout = aiohttp.ClientTimeout(total=4.0)
            connector = aiohttp.TCPConnector(limit=100, limit_per_host=100, keepalive_timeout=30.0)
            self.session = aiohttp.ClientSession(timeout=timeout, connector=connector)

    async def close_session(self):
        if self.session and not self.session.closed:
            await self.session.close()
            self.session = None

    def _get_headers(self, watch: Optional[VirtualWatch] = None) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        # Mode camouflage Garmin opt-in : si activé, le simulateur se fait passer pour une montre officielle
        if self.store.spoof_garmin_signature:
            headers["x-garmin-signature"] = "CIQ_OFFICIAL_ROWER_V1"
        if watch:
            headers["x-device-id"] = watch.device_id
            if watch.device_token:
                headers["Authorization"] = f"Bearer {watch.device_token}"
                headers["x-device-token"] = watch.device_token
        if self.store.load_test_key:
            headers["x-load-test-key"] = self.store.load_test_key
        return headers

    def get_active_races_summary(self) -> List[Dict[str, Any]]:
        """Groups active watches by their engaged race so the dashboard can show parallel race basins."""
        groups: Dict[str, Dict[str, Any]] = {}
        for w in self.store.get_all_watches():
            if not w.is_enabled or not w.race_id:
                continue
            rid = w.race_id
            if rid not in groups:
                cached = self.race_status_cache.get(rid, {})
                groups[rid] = {
                    "race_id": rid,
                    "race_pin": w.race_pin or cached.get("pinCode") or (rid if rid == "PUBLIC" else None),
                    "race_title": w.race_title or cached.get("title") or ("Course Publique" if w.race_mode == "PUBLIC" else f"Salon {w.race_pin or rid}"),
                    "race_mode": w.race_mode or "PRIVATE",
                    "game_mode": w.game_mode or cached.get("gameMode") or "multi",
                    "bot_start_mode": w.bot_start_mode or cached.get("botStartMode"),
                    "start_mode": w.start_mode or cached.get("startMode") or "manual",
                    "scheduled_start_time": w.scheduled_start_time or cached.get("scheduledStartTime"),
                    "waiting_status_message": w.waiting_status_message or cached.get("waitingStatusMessage"),
                    "status": w.race_status,
                    "target_distance": w.target_distance,
                    "countdown_remaining": w.countdown_remaining,
                    "watch_ids": [],
                    "simulating_count": 0,
                    "running_count": 0,
                    "finished_count": 0,
                }
            g = groups[rid]
            g["watch_ids"].append(w.id)
            if w.is_simulating:
                g["simulating_count"] += 1
            if w.race_status == "RUNNING":
                g["running_count"] += 1
                g["status"] = "RUNNING"
            elif w.race_status == "COUNTDOWN" and g["status"] not in ("RUNNING",):
                g["status"] = "COUNTDOWN"
            elif w.race_status == "FINISHED":
                g["finished_count"] += 1
            if w.countdown_remaining is not None:
                g["countdown_remaining"] = w.countdown_remaining
            if w.waiting_status_message:
                g["waiting_status_message"] = w.waiting_status_message
            if w.race_title and (not g["race_title"] or g["race_title"].startswith("Salon ")):
                g["race_title"] = w.race_title

        for g in groups.values():
            if g["finished_count"] > 0 and g["finished_count"] == len(g["watch_ids"]):
                g["status"] = "FINISHED"

        return list(groups.values())

    async def pair_watch_pin(self, watch_id: int, pairing_pin: str) -> Dict[str, Any]:
        """Validates 6-character pairing code with backend POST /api/garmin/pair"""
        await self.init_session()
        watch = self.store.get_watch(watch_id)
        if not watch:
            return {"success": False, "message": "Montre introuvable"}

        clean_pin = pairing_pin.strip().upper()
        url = f"{self.store.backend_url}/api/garmin/pair"
        payload = {
            "pairingCode": clean_pin,
            "deviceId": watch.device_id
        }
        headers = self._get_headers(watch)

        try:
            start_t = time.perf_counter()
            async with self.session.post(url, json=payload, headers=headers) as resp:
                rtt_ms = (time.perf_counter() - start_t) * 1000
                data = await resp.json()
                self.metrics.record_request(resp.status, rtt_ms)

                if resp.status == 200 and data.get("success"):
                    watch.device_token = data.get("deviceToken")
                    watch.user_id = data.get("userId")
                    watch.user_name = data.get("userName") or data.get("playerName") or watch.user_id
                    watch.is_paired = True
                    watch.error_message = None
                    self.store.save()
                    return {"success": True, "message": f"Appairé à {watch.user_name} !", "data": data}
                else:
                    msg = data.get("message") or data.get("error") or f"Erreur HTTP {resp.status}"
                    watch.error_message = msg
                    return {"success": False, "message": msg}
        except Exception as e:
            msg = f"Connexion impossible: {str(e)}"
            watch.error_message = msg
            return {"success": False, "message": msg}

    async def set_watch_ble_ready(self, watch: VirtualWatch, ready: bool = True) -> Dict[str, Any]:
        """Notifies backend POST /api/rooms/:roomId/status that the rower is awake and READY."""
        if not watch.race_id or watch.race_mode == "PUBLIC":
            watch.is_ble_ready = ready
            return {"success": True}

        await self.init_session()
        url = f"{self.store.backend_url}/api/rooms/{watch.race_id}/status"
        payload: Dict[str, Any] = {
            "roomId": watch.race_id,
            "raceId": watch.race_id,
            "userId": watch.user_id or watch.device_id,
            "ready": ready
        }
        if watch.device_token:
            payload["deviceToken"] = watch.device_token

        headers = self._get_headers(watch)
        try:
            start_t = time.perf_counter()
            async with self.session.post(url, json=payload, headers=headers) as resp:
                rtt_ms = (time.perf_counter() - start_t) * 1000
                self.metrics.record_request(resp.status, rtt_ms)
                if resp.status == 200:
                    data = await resp.json()
                    watch.is_ble_ready = ready
                    st = data.get("internalStatus") or data.get("status")
                    if st in ("COUNTDOWN", "countdown"):
                        watch.race_status = "COUNTDOWN"
                    elif st in ("RUNNING", "in_progress"):
                        watch.race_status = "RUNNING"
                    sec_rem = data.get("secondsRemaining") if data.get("secondsRemaining") is not None else data.get("countdownSeconds")
                    if isinstance(sec_rem, (int, float)):
                        watch.countdown_remaining = int(sec_rem)
                    if data.get("waitingStatusMessage"):
                        watch.waiting_status_message = data.get("waitingStatusMessage")
                    return {"success": True, "data": data}
                return {"success": False, "status": resp.status}
        except Exception as e:
            return {"success": False, "message": str(e)}

    async def claim_race_pin(self, watch_id: int, race_pin: str, auto_arm: Optional[bool] = None) -> Dict[str, Any]:
        """
        Engages a virtual watch on a private salon or duel by PIN / code.
        - If the watch is already paired to a user account, uses POST /api/rooms/join so its account identity is preserved.
        - Otherwise falls back to POST /api/garmin/claim-ticket for guest onboarding.
        - Automatically sets the rower BLE status to READY and arms the simulation loop to start sending data when the race starts.
        """
        await self.init_session()
        watch = self.store.get_watch(watch_id)
        if not watch:
            return {"success": False, "message": "Montre introuvable"}

        clean_pin = race_pin.strip().upper()
        if clean_pin == "PUBLIC":
            return await self.join_public_race(watch_id, auto_arm=auto_arm)

        should_arm = self.store.auto_sync_on_engage if auto_arm is None else bool(auto_arm)

        # If watch is paired with a user account, use /api/rooms/join with ready=True to preserve user account identity
        use_rooms_join = bool(watch.is_paired and (watch.user_id or watch.device_token))
        url = f"{self.store.backend_url}/api/rooms/join" if use_rooms_join else f"{self.store.backend_url}/api/garmin/claim-ticket"

        payload: Dict[str, Any] = {
            "code": clean_pin,
            "pin": clean_pin,
            "ticketPin": clean_pin,
            "deviceId": watch.device_id,
            "userId": watch.user_id or watch.device_id,
            "userName": watch.user_name or f"Rameur_{watch.id:02d}",
            "ready": True,
        }
        if watch.device_token:
            payload["deviceToken"] = watch.device_token

        headers = self._get_headers(watch)

        try:
            start_t = time.perf_counter()
            async with self.session.post(url, json=payload, headers=headers) as resp:
                rtt_ms = (time.perf_counter() - start_t) * 1000
                data = await resp.json()
                self.metrics.record_request(resp.status, rtt_ms)

                # Fallback to claim-ticket if rooms/join failed for a guest ticket
                if resp.status != 200 and use_rooms_join and resp.status not in (409, 410):
                    fallback_url = f"{self.store.backend_url}/api/garmin/claim-ticket"
                    async with self.session.post(fallback_url, json=payload, headers=headers) as f_resp:
                        rtt_ms = (time.perf_counter() - start_t) * 1000
                        data = await f_resp.json()
                        resp_status = f_resp.status
                        self.metrics.record_request(resp_status, rtt_ms)
                else:
                    resp_status = resp.status

                if resp_status == 200 and data.get("success"):
                    if data.get("deviceToken") and not watch.device_token:
                        watch.device_token = data.get("deviceToken")
                        watch.is_paired = True
                    if data.get("userId") and not watch.user_id:
                        watch.user_id = data.get("userId")
                    if (data.get("userName") or data.get("guestName")) and not watch.user_name:
                        watch.user_name = data.get("userName") or data.get("guestName")

                    race_obj = data.get("race") or {}
                    watch.race_id = data.get("raceId") or data.get("roomId") or race_obj.get("id") or clean_pin
                    watch.race_pin = data.get("pinCode") or race_obj.get("pinCode") or clean_pin
                    watch.race_title = data.get("title") or race_obj.get("title") or f"Salon {watch.race_pin}"
                    watch.game_mode = data.get("gameMode") or race_obj.get("gameMode") or ("duel_1v1" if data.get("isDuel1v1") else "multi")
                    watch.race_mode = "DUEL" if (data.get("isDuel1v1") or watch.game_mode == "duel_1v1") else "PRIVATE"
                    watch.bot_start_mode = data.get("botStartMode") or race_obj.get("botStartMode")
                    watch.start_mode = data.get("startMode") or race_obj.get("startMode") or "manual"
                    watch.scheduled_start_time = data.get("scheduledStartTime") or race_obj.get("scheduledStartTime")
                    watch.waiting_status_message = data.get("waitingStatusMessage") or race_obj.get("waitingStatusMessage")
                    watch.lane = data.get("lane") if data.get("lane") is not None else watch.lane
                    if data.get("targetDistance") or race_obj.get("targetDistance"):
                        watch.target_distance = int(data.get("targetDistance") or race_obj.get("targetDistance"))

                    internal_st = data.get("internalStatus") or race_obj.get("internalStatus") or data.get("status")
                    if internal_st in ("RUNNING", "in_progress"):
                        watch.race_status = "RUNNING"
                    elif internal_st in ("COUNTDOWN", "countdown"):
                        watch.race_status = "COUNTDOWN"
                    else:
                        watch.race_status = "LOBBY"

                    sec_rem = data.get("secondsRemaining") if data.get("secondsRemaining") is not None else data.get("countdownSeconds")
                    if isinstance(sec_rem, (int, float)):
                        watch.countdown_remaining = int(sec_rem)

                    watch.current_distance = 0.0
                    watch.elapsed_time = 0.0
                    watch.stroke_count = 0
                    watch.initial_waiting_sent = False
                    watch.last_poll_timestamp = 0.0
                    watch.engaged_at_ts = time.time()
                    watch.error_message = None

                    # Notify BLE READY so scheduled / duel 1v1 countdowns unlock immediately
                    await self.set_watch_ble_ready(watch, True)

                    self.store.save()

                    if should_arm and watch.is_enabled:
                        await self.start_watch_simulation(watch.id)

                    return {
                        "success": True,
                        "status_code": 200,
                        "race_id": watch.race_id,
                        "race_pin": watch.race_pin,
                        "lane": watch.lane,
                        "message": f"Engagé sur {watch.race_title} (Ligne {watch.lane}) !",
                        "data": data
                    }
                else:
                    msg = data.get("message") or data.get("error") or f"Erreur HTTP {resp_status}"
                    watch.error_message = msg
                    return {"success": False, "status_code": resp_status, "message": msg}
        except Exception as e:
            msg = f"Échec de l'engagement: {str(e)}"
            watch.error_message = msg
            return {"success": False, "status_code": 500, "message": msg}

    async def join_public_race(self, watch_id: int, auto_arm: Optional[bool] = None) -> Dict[str, Any]:
        """Joins the current/next public hourly race and arms auto-sync with race start."""
        await self.init_session()
        watch = self.store.get_watch(watch_id)
        if not watch:
            return {"success": False, "message": "Montre introuvable"}

        should_arm = self.store.auto_sync_on_engage if auto_arm is None else bool(auto_arm)

        # 1. Fetch current public race
        curr_url = f"{self.store.backend_url}/api/v1/races/current"
        next_url = f"{self.store.backend_url}/api/race/next"
        race_id = None
        race_title = "Course Publique"
        race_pin = "PUBLIC"
        target_dist = 2000
        internal_status = "LOBBY"

        try:
            async with self.session.get(curr_url) as resp:
                if resp.status == 200:
                    d = await resp.json()
                    r = d.get("race") or {}
                    race_id = r.get("id")
                    race_title = r.get("title") or "Course Publique"
                    race_pin = r.get("pinCode") or d.get("pinCode") or "PUBLIC"
                    internal_status = r.get("internalStatus") or d.get("internalStatus") or r.get("status") or "LOBBY"
                    if r.get("targetDistance"):
                        target_dist = int(r.get("targetDistance"))
        except Exception:
            pass

        if not race_id:
            try:
                async with self.session.get(next_url) as resp:
                    if resp.status == 200:
                        d = await resp.json()
                        race_id = d.get("raceId") or d.get("id")
            except Exception:
                pass

        if not race_id:
            race_id = "PUBLIC"

        # 2. Join race
        join_url = f"{self.store.backend_url}/api/race/join"
        payload = {
            "userId": watch.user_id or watch.device_id,
            "userName": watch.user_name or f"Rameur_{watch.id:02d}",
            "deviceId": watch.device_id,
            "action": "join",
            "raceId": race_id
        }
        if watch.device_token:
            payload["deviceToken"] = watch.device_token

        headers = self._get_headers(watch)

        try:
            start_t = time.perf_counter()
            async with self.session.post(join_url, json=payload, headers=headers) as resp:
                rtt_ms = (time.perf_counter() - start_t) * 1000
                data = await resp.json()
                self.metrics.record_request(resp.status, rtt_ms)

                if resp.status >= 400 and not data.get("success", True):
                    msg = data.get("message") or data.get("error") or f"HTTP {resp.status}"
                    watch.error_message = msg
                    return {"success": False, "status_code": resp.status, "message": msg}

                watch.race_id = data.get("raceId") or race_id
                watch.race_title = race_title
                watch.race_pin = race_pin
                watch.race_mode = "PUBLIC"
                watch.game_mode = "public"
                if internal_status in ("RUNNING", "in_progress"):
                    watch.race_status = "RUNNING"
                elif internal_status in ("COUNTDOWN", "countdown"):
                    watch.race_status = "COUNTDOWN"
                else:
                    watch.race_status = "LOBBY"
                watch.target_distance = target_dist
                watch.current_distance = 0.0
                watch.elapsed_time = 0.0
                watch.stroke_count = 0
                watch.initial_waiting_sent = False
                watch.last_poll_timestamp = 0.0
                watch.engaged_at_ts = time.time()
                watch.is_ble_ready = True
                watch.error_message = None
                self.store.save()

                if should_arm and watch.is_enabled:
                    await self.start_watch_simulation(watch.id)

                return {
                    "success": True,
                    "status_code": 200,
                    "race_id": watch.race_id,
                    "message": f"Engagé sur {watch.race_title} ({watch.race_id}) !",
                    "data": data
                }
        except Exception as e:
            # Fallback direct: set to lobby ready for public
            watch.race_id = race_id
            watch.race_title = race_title
            watch.race_pin = "PUBLIC"
            watch.race_mode = "PUBLIC"
            watch.game_mode = "public"
            watch.race_status = "LOBBY"
            watch.initial_waiting_sent = False
            watch.last_poll_timestamp = 0.0
            watch.engaged_at_ts = time.time()
            watch.is_ble_ready = True
            self.store.save()
            if should_arm and watch.is_enabled:
                await self.start_watch_simulation(watch.id)
            return {"success": True, "status_code": 200, "race_id": watch.race_id, "message": f"Assigné à la course publique {race_id}"}

    async def fetch_user_enrolled_races(self, watch_id: int) -> Dict[str, Any]:
        """Queries backend GET /api/v1/races/user-enrolled for a virtual watch and updates watch.enrolled_races."""
        await self.init_session()
        watch = self.store.get_watch(watch_id)
        if not watch:
            return {"success": False, "message": "Montre introuvable", "enrolledRaces": []}

        if not watch.user_id and not watch.device_token:
            return {"success": False, "message": "Montre non appairée à un joueur virtuel", "enrolledRaces": []}

        params = {}
        if watch.user_id:
            params["userId"] = watch.user_id
        if watch.device_token:
            params["deviceToken"] = watch.device_token

        url = f"{self.store.backend_url}/api/v1/races/user-enrolled"
        headers = self._get_headers(watch)

        try:
            start_t = time.perf_counter()
            async with self.session.get(url, params=params, headers=headers) as resp:
                rtt_ms = (time.perf_counter() - start_t) * 1000
                self.metrics.record_request(resp.status, rtt_ms)
                if resp.status == 200:
                    data = await resp.json()
                    enrolled = data.get("enrolledRaces") or []
                    compact_list = []
                    for item in enrolled:
                        r = item.get("race") or {}
                        compact_list.append({
                            "race_id": r.get("id") or item.get("id"),
                            "pin_code": item.get("pinCode") or r.get("pinCode") or r.get("code"),
                            "code": r.get("code") or item.get("code"),
                            "title": r.get("title") or "Salon Privé",
                            "status": r.get("internalStatus") or item.get("internalStatus") or r.get("status"),
                            "target_distance": r.get("targetDistance") or 2000,
                            "game_mode": r.get("gameMode") or item.get("gameMode") or "multi",
                            "start_mode": r.get("startMode") or item.get("startMode") or "manual",
                            "scheduled_start_time": r.get("scheduledStartTime") or item.get("scheduledStartTime"),
                            "role": item.get("role"),
                            "is_engaged_on_lane": bool(item.get("isEngagedOnLane")),
                            "assigned_lane": item.get("assignedLane") or 0,
                        })
                    watch.enrolled_races = compact_list
                    return {
                        "success": True,
                        "count": len(compact_list),
                        "recommended": compact_list[0] if compact_list else None,
                        "enrolledRaces": compact_list,
                    }
                else:
                    return {"success": False, "message": f"Erreur HTTP {resp.status}", "enrolledRaces": []}
        except Exception as e:
            return {"success": False, "message": f"Erreur: {str(e)}", "enrolledRaces": []}

    async def auto_engage_watch_enrolled(
        self,
        watch_id: int,
        target_race_id_or_pin: Optional[str] = None,
        fallback_public: bool = False,
        auto_arm: Optional[bool] = None
    ) -> Dict[str, Any]:
        """
        Finds the races the virtual player is registered in and automatically engages their kayak on it.
        If target_race_id_or_pin is specified, engages on that specific race; otherwise picks the highest priority enrolled race.
        """
        watch = self.store.get_watch(watch_id)
        if not watch:
            return {"success": False, "message": "Montre introuvable"}

        res = await self.fetch_user_enrolled_races(watch_id)
        enrolled = res.get("enrolledRaces") or []

        chosen = None
        if target_race_id_or_pin:
            clean_target = target_race_id_or_pin.strip().upper()
            for r in enrolled:
                if (
                    (r.get("race_id") or "").upper() == clean_target or
                    (r.get("pin_code") or "").upper() == clean_target or
                    (r.get("code") or "").upper() == clean_target
                ):
                    chosen = r
                    break
            if not chosen:
                # Direct engagement with the provided PIN/ID
                return await self.claim_race_pin(watch_id, clean_target, auto_arm=auto_arm)
        elif enrolled:
            chosen = enrolled[0]

        if chosen:
            pin_or_id = chosen.get("pin_code") or chosen.get("code") or chosen.get("race_id")
            claim_res = await self.claim_race_pin(watch_id, pin_or_id, auto_arm=auto_arm)
            return {
                **claim_res,
                "enrolled_count": len(enrolled),
                "chosen_race": chosen,
            }

        if fallback_public:
            pub_res = await self.join_public_race(watch_id, auto_arm=auto_arm)
            return {
                **pub_res,
                "enrolled_count": 0,
                "fallback_public": True,
            }

        return {
            "success": False,
            "enrolled_count": 0,
            "message": f"Aucune course inscrite trouvée pour {watch.user_name or watch.user_id or watch.device_id}"
        }

    async def distribute_watches_across_races(
        self,
        watch_ids: List[int],
        race_targets: List[str],
        mode: str = "round_robin",
        auto_arm: Optional[bool] = None
    ) -> Dict[str, Any]:
        """
        Distributes selected active watches across multiple race PINs / codes / 'PUBLIC'.
        - mode == 'round_robin': alternates watches evenly across targets, skipping targets that return 409 (full) or 410 (closed).
        - mode == 'sequential': fills target 1 until full (409), then moves to target 2, etc.
        """
        clean_targets = [t.strip().upper() for t in race_targets if t and t.strip()]
        if not clean_targets:
            return {"success": False, "message": "Aucune cible de course fournie."}

        active_ids = [
            wid for wid in watch_ids
            if self.store.get_watch(wid) and self.store.get_watch(wid).is_enabled
        ]
        if not active_ids:
            return {"success": False, "message": "Aucun kayak actif sélectionné."}

        full_or_closed_targets = set()
        engaged_by_target: Dict[str, List[int]] = {t: [] for t in clean_targets}
        errors: List[str] = []
        engaged_count = 0

        target_idx = 0

        for wid in active_ids:
            available_targets = [t for t in clean_targets if t not in full_or_closed_targets]
            if not available_targets:
                errors.append(f"#{wid}: Tous les salons cibles sont complets ou fermés.")
                break

            assigned = False
            attempts = 0
            max_attempts = len(clean_targets)

            while attempts < max_attempts and not assigned:
                if mode == "sequential":
                    # Find first non-full target in order
                    current_target = available_targets[0]
                else:
                    # Round-robin across non-full targets
                    candidate = clean_targets[target_idx % len(clean_targets)]
                    target_idx += 1
                    if candidate in full_or_closed_targets:
                        attempts += 1
                        continue
                    current_target = candidate

                attempts += 1
                if current_target == "PUBLIC":
                    res = await self.join_public_race(wid, auto_arm=auto_arm)
                else:
                    res = await self.claim_race_pin(wid, current_target, auto_arm=auto_arm)

                if res.get("success"):
                    engaged_count += 1
                    engaged_by_target[current_target].append(wid)
                    assigned = True
                else:
                    status_code = res.get("status_code")
                    msg = res.get("message") or ""
                    # If room is full (409) or closed (410) or not found (404), mark target as unavailable and try next target!
                    if status_code in (404, 409, 410) or "complet" in msg.lower() or "quota" in msg.lower():
                        full_or_closed_targets.add(current_target)
                        available_targets = [t for t in clean_targets if t not in full_or_closed_targets]
                        if not available_targets:
                            errors.append(f"#{wid}: {msg}")
                            break
                    else:
                        errors.append(f"#{wid} ({current_target}): {msg}")
                        break

        summary_parts = [f"{t}: {len(wids)} kayak(s)" for t, wids in engaged_by_target.items() if len(wids) > 0]
        summary_str = " • ".join(summary_parts) if summary_parts else "0 engagé"

        return {
            "success": engaged_count > 0,
            "engaged_count": engaged_count,
            "total_selected": len(active_ids),
            "distribution": engaged_by_target,
            "full_targets": list(full_or_closed_targets),
            "errors": errors[:8],
            "message": f"{engaged_count}/{len(active_ids)} kayaks répartis ({summary_str})"
        }

    async def trigger_first_stroke_for_race(self, race_id: Optional[str] = None, watch_ids: Optional[List[int]] = None) -> Dict[str, Any]:
        """Forces an immediate first stroke / RUNNING transition for watches in a specific race or selection."""
        await self.init_session()
        if watch_ids is not None:
            targets = [self.store.get_watch(wid) for wid in watch_ids if self.store.get_watch(wid)]
        elif race_id:
            targets = self.store.get_watches_for_race(race_id)
        else:
            targets = self.store.get_enabled_watches()

        triggered = 0
        for w in targets:
            if not w or not w.is_enabled or not w.race_id:
                continue
            if not w.is_simulating:
                await self.start_watch_simulation(w.id)
            # Send an immediate active stroke packet to trigger first_stroke on backend
            w.current_power = float(w.target_power)
            v = math.pow(w.current_power / 2.80, 1.0 / 3.0)
            w.current_split = round(500.0 / max(0.5, v), 1)
            w.current_spm = max(20.0, 18.0 + 0.45 * math.sqrt(w.current_power))
            w.stroke_count = max(1, w.stroke_count + 1)
            w.elapsed_time = max(1.0, w.elapsed_time + 1.0)
            w.current_distance = max(3.0, w.current_distance + v)
            await self._send_telemetry(w, status="in_progress", dt=1.0)
            triggered += 1

        return {"success": triggered > 0, "triggered_count": triggered, "message": f"1er coup de rame envoyé pour {triggered} kayak(s) !"}

    async def start_watch_simulation(self, watch_id: int):
        watch = self.store.get_watch(watch_id)
        if not watch or not watch.is_enabled or watch.id in self.watch_tasks:
            return
        watch.is_simulating = True
        task = asyncio.create_task(self._watch_loop(watch))
        self.watch_tasks[watch.id] = task

    async def stop_watch_simulation(self, watch_id: int):
        watch = self.store.get_watch(watch_id)
        if watch:
            watch.is_simulating = False
        task = self.watch_tasks.pop(watch_id, None)
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    async def start_all(self, watch_ids: Optional[List[int]] = None, race_id: Optional[str] = None):
        await self.init_session()
        self.running = True
        if race_id:
            targets = [w.id for w in self.store.get_watches_for_race(race_id) if w.is_enabled]
        elif watch_ids is not None:
            targets = [wid for wid in watch_ids if self.store.get_watch(wid) and self.store.get_watch(wid).is_enabled]
        else:
            targets = [w.id for w in self.store.get_enabled_watches()]
        for wid in targets:
            await self.start_watch_simulation(wid)

    async def stop_all(self, watch_ids: Optional[List[int]] = None, race_id: Optional[str] = None):
        if race_id:
            targets = [w.id for w in self.store.get_watches_for_race(race_id)]
        elif watch_ids is not None:
            targets = watch_ids
        else:
            self.running = False
            targets = list(self.watch_tasks.keys())
        for wid in targets:
            await self.stop_watch_simulation(wid)

    async def reset_all(self, watch_ids: Optional[List[int]] = None, race_id: Optional[str] = None, clear_assignment: bool = False):
        if race_id:
            targets = [w.id for w in self.store.get_watches_for_race(race_id)]
        elif watch_ids is not None:
            targets = watch_ids
        else:
            targets = list(self.store.watches.keys())
        for wid in targets:
            await self.stop_watch_simulation(wid)
            w = self.store.get_watch(wid)
            if w:
                w.reset_race(clear_assignment=clear_assignment)
        self.store.save()

    async def _watch_loop(self, watch: VirtualWatch):
        """1-Hz High Precision Simulation Loop per Garmin Watch"""
        last_tick = time.time()
        while watch.is_simulating:
            now = time.time()
            dt = max(0.2, min(2.0, now - last_tick))
            last_tick = now

            try:
                # 1. State machine handling
                if watch.race_status in ("IDLE", "LOBBY", "COUNTDOWN"):
                    await self._handle_waiting_state(watch)
                elif watch.race_status == "RUNNING":
                    await self._handle_running_state(watch, dt)
                elif watch.race_status == "FINISHED":
                    # Cool-down state
                    await asyncio.sleep(2.0)
                    continue

            except asyncio.CancelledError:
                break
            except Exception as e:
                watch.error_message = str(e)

            # Cadence regulation: 1.0s interval
            elapsed = time.time() - now
            sleep_time = max(0.1, 1.0 - elapsed)
            await asyncio.sleep(sleep_time)

    async def _poll_shared_race_status(self, watch: VirtualWatch) -> Optional[Dict[str, Any]]:
        """
        Polls race status with a short shared cache (0.8s) per race_id so that 15 watches in the same race
        get instant sub-second synchronization without hammering the status endpoint 15 times per second.
        """
        if not watch.race_id:
            return None

        now = time.time()
        cache_key = "PUBLIC" if watch.race_mode == "PUBLIC" else watch.race_id
        cached = self.race_status_cache.get(cache_key)
        if cached and (now - cached.get("_fetched_at", 0.0) < 0.8):
            return cached

        url = f"{self.store.backend_url}/api/v1/races/private/{watch.race_id}"
        if watch.race_mode == "PUBLIC":
            url = f"{self.store.backend_url}/api/v1/races/current"

        headers = self._get_headers(watch)
        try:
            start_t = time.perf_counter()
            async with self.session.get(url, headers=headers) as resp:
                rtt = (time.perf_counter() - start_t) * 1000
                self.metrics.record_request(resp.status, rtt)
                watch.last_http_code = resp.status
                watch.last_rtt_ms = rtt

                if resp.status == 200:
                    data = await resp.json()
                    race = data.get("race") or data
                    info = {
                        "_fetched_at": now,
                        "id": race.get("id") or watch.race_id,
                        "title": race.get("title") or data.get("title"),
                        "pinCode": race.get("pinCode") or data.get("pinCode"),
                        "internalStatus": race.get("internalStatus") or data.get("internalStatus") or race.get("status") or data.get("status"),
                        "targetDistance": race.get("targetDistance") or data.get("targetDistance"),
                        "secondsRemaining": data.get("secondsRemaining") if data.get("secondsRemaining") is not None else data.get("countdownSeconds"),
                        "gameMode": race.get("gameMode") or data.get("gameMode"),
                        "botStartMode": race.get("botStartMode") or data.get("botStartMode"),
                        "startMode": race.get("startMode") or data.get("startMode"),
                        "scheduledStartTime": race.get("scheduledStartTime") or data.get("scheduledStartTime"),
                        "waitingStatusMessage": data.get("waitingStatusMessage") or race.get("waitingStatusMessage"),
                    }
                    self.race_status_cache[cache_key] = info
                    return info
        except Exception:
            pass
        return None

    async def _handle_waiting_state(self, watch: VirtualWatch):
        """
        Polls race status and synchronizes telemetry start with the exact race start:
        - Sends a single 0m waiting packet when entering the starting line.
        - Ensures BLE READY status is sent for private salons.
        - If the race is a Solo or Bot Duel in 'first_stroke' mode, automatically triggers the first stroke after first_stroke_auto_delay_sec (if > 0).
        - Immediately transitions to RUNNING when the race enters RUNNING / in_progress.
        """
        if not watch.race_id:
            await asyncio.sleep(1.0)
            return

        now = time.time()
        # Send a single 0m telemetry packet once when entering the starting line
        if watch.is_simulating and watch.race_id and not getattr(watch, "initial_waiting_sent", False):
            watch.initial_waiting_sent = True
            if not watch.is_ble_ready and watch.race_mode != "PUBLIC":
                await self.set_watch_ble_ready(watch, True)
            await self._send_telemetry(watch, status="waiting", dt=0.0)
            if watch.race_status == "RUNNING":
                return

        # Check if this race is waiting for first_stroke (Solo or Bot Duel with botStartMode == 'first_stroke')
        is_first_stroke_mode = (
            watch.game_mode == "solo" or
            (watch.game_mode == "bot_duel" and watch.bot_start_mode == "first_stroke")
        )
        delay_cfg = self.store.first_stroke_auto_delay_sec
        if (
            is_first_stroke_mode and
            watch.race_status in ("LOBBY", "COUNTDOWN") and
            delay_cfg > 0 and
            watch.engaged_at_ts > 0 and
            (now - watch.engaged_at_ts) >= delay_cfg
        ):
            # Trigger first stroke automatically after configured delay
            watch.current_power = float(watch.target_power)
            v = math.pow(watch.current_power / 2.80, 1.0 / 3.0)
            watch.current_split = round(500.0 / max(0.5, v), 1)
            watch.current_spm = max(20.0, 18.0 + 0.45 * math.sqrt(watch.current_power))
            watch.stroke_count = 1
            watch.elapsed_time = 1.0
            watch.current_distance = round(v, 1)
            await self._send_telemetry(watch, status="in_progress", dt=1.0)
            if watch.race_status == "RUNNING":
                return

        # Adaptive polling interval: 1.0s when countdown <= 10s or shared cache available, otherwise 1.5s
        cd = getattr(watch, "countdown_remaining", None)
        poll_interval = 0.8 if (watch.race_status == "COUNTDOWN" and cd is not None and cd <= 10) else 1.5
        last_poll = getattr(watch, "last_poll_timestamp", 0.0)
        if now - last_poll < poll_interval:
            return
        watch.last_poll_timestamp = now

        info = await self._poll_shared_race_status(watch)
        if not info:
            return

        if info.get("title"):
            watch.race_title = info["title"]
        if info.get("targetDistance"):
            watch.target_distance = int(info["targetDistance"])
        if info.get("gameMode"):
            watch.game_mode = info["gameMode"]
        if info.get("botStartMode"):
            watch.bot_start_mode = info["botStartMode"]
        if info.get("startMode"):
            watch.start_mode = info["startMode"]
        if info.get("scheduledStartTime"):
            watch.scheduled_start_time = info["scheduledStartTime"]
        if info.get("waitingStatusMessage"):
            watch.waiting_status_message = info["waitingStatusMessage"]

        sec_rem = info.get("secondsRemaining")
        if isinstance(sec_rem, (int, float)):
            watch.countdown_remaining = int(sec_rem)

        st = info.get("internalStatus")
        if st in ("RUNNING", "in_progress"):
            watch.race_status = "RUNNING"
            watch.countdown_remaining = 0
            watch.elapsed_time = 0.0
            watch.current_distance = 0.0
            # Send the initial running stroke right away on start detection
            await self._handle_running_state(watch, 1.0)
        elif st in ("COUNTDOWN", "countdown"):
            watch.race_status = "COUNTDOWN"
        elif st in ("LOBBY", "waiting"):
            watch.race_status = "LOBBY"

    async def _handle_running_state(self, watch: VirtualWatch, dt: float):
        """Simulates physiological rowing stroke at 1Hz and transmits FTMS packet every ~1.8s (or on finish)."""
        # 1. Physics & Jitter
        target_p = float(watch.target_power)
        # Organic Gaussian fluctuation of ±2.5%
        jitter_factor = 1.0 + random.gauss(0.0, 0.025)
        watch.current_power = max(40.0, min(1000.0, target_p * jitter_factor))

        # Speed from Concept2 formula: v = (Power / 2.80)^(1/3)
        v = math.pow(watch.current_power / 2.80, 1.0 / 3.0)
        watch.current_split = round(500.0 / max(0.5, v), 1)

        # Cadence correlated with power: SPM = 18 + 0.45 * sqrt(P) + random oscillation
        spm_base = 18.0 + 0.45 * math.sqrt(watch.current_power)
        watch.current_spm = max(18.0, min(38.0, spm_base + random.uniform(-0.8, 0.8)))

        # Stroke count increment
        strokes_this_second = (watch.current_spm / 60.0) * dt
        stroke_occurred = False
        if random.random() < strokes_this_second:
            watch.stroke_count += 1
            stroke_occurred = True

        # Distance progression
        watch.elapsed_time += dt
        watch.current_distance += v * dt

        # Cardiac drift: starts at 132 bpm, climbs to 175 bpm with distance
        progress_ratio = min(1.0, watch.current_distance / max(100, watch.target_distance))
        watch.current_hr = int(130 + 45.0 * progress_ratio + random.randint(-1, 1))

        # Check finish line
        is_final = False
        if watch.current_distance >= watch.target_distance:
            watch.current_distance = float(watch.target_distance)
            watch.race_status = "FINISHED"
            is_final = True

        # Send telemetry immediately on finish, or when a stroke occurs (>= 1.5s since last sync), or fallback every 2.0s
        now = time.time()
        since_last_sync = now - (watch.last_sync_timestamp or 0.0)
        should_send = is_final or (stroke_occurred and since_last_sync >= 1.5) or (since_last_sync >= 2.0)

        if should_send:
            status_str = "finished" if is_final else "in_progress"
            await self._send_telemetry(watch, status=status_str, dt=dt)

        if is_final:
            watch.is_simulating = False

    async def _send_telemetry(self, watch: VirtualWatch, status: str, dt: float):
        """Dispatches FTMS payload to POST /api/garmin/boost"""
        url = f"{self.store.backend_url}/api/garmin/boost"
        now_ms = int(time.time() * 1000)

        # If status is waiting (on the starting blocks), ensure 0 watts / 0 spm / 0m so we don't trigger a false start
        if status == "waiting":
            send_dist = 0.0
            send_power = 0
            send_split = 0
            send_spm = 0.0
        else:
            send_dist = float(watch.target_distance) if (status == "finished" or watch.current_distance >= watch.target_distance) else watch.current_distance
            send_power = round(watch.current_power)
            send_split = round(watch.current_split)
            send_spm = round(watch.current_spm, 1)

        payload = {
            "raceId": watch.race_id or "PUBLIC",
            "userId": watch.user_id or watch.device_id,
            "userName": watch.user_name or f"Rameur_{watch.id:02d}",
            "deviceToken": watch.device_token,
            "deviceId": watch.device_id,
            "seq": watch.stroke_count,
            "timestamp": now_ms,
            "elapsedTime": round(watch.elapsed_time),
            "currentDistance": round(send_dist),
            "instantPower": send_power,
            "instantPace": send_split,
            "strokeRate": send_spm,
            "spm": send_spm,
            "status": status,
            "targetDistance": watch.target_distance,
            "metrics": {
                "distanceM": round(send_dist),
                "splitSec": send_split,
                "powerWatts": send_power,
                "strokeRate": send_spm,
                "spm": send_spm,
                "heartRate": watch.current_hr
            },
            "watchModel": watch.watch_model,
            "rowerModel": watch.rower_model,
        }

        headers = self._get_headers(watch)

        try:
            start_t = time.perf_counter()
            async with self.session.post(url, json=payload, headers=headers) as resp:
                rtt_ms = (time.perf_counter() - start_t) * 1000
                self.metrics.record_request(resp.status, rtt_ms)
                watch.last_http_code = resp.status
                watch.last_rtt_ms = rtt_ms
                watch.last_sync_timestamp = time.time()

                if resp.status == 200:
                    watch.error_message = None
                    try:
                        data = await resp.json()
                        server_st = data.get("status")
                        if server_st in ("RUNNING", "in_progress") and watch.race_status in ("LOBBY", "COUNTDOWN", "IDLE"):
                            watch.race_status = "RUNNING"

                        # Synchronisation bidirectionnelle avec la distance officielle normalisée du serveur
                        server_dist = data.get("normDistM")
                        if server_dist is not None and isinstance(server_dist, (int, float)):
                            if server_dist > watch.current_distance:
                                watch.current_distance = float(server_dist)

                        # Si le serveur confirme que le coureur a fini OU si la montre a atteint l'objectif
                        if data.get("isFinished") or (status != "waiting" and watch.current_distance >= watch.target_distance):
                            watch.current_distance = float(watch.target_distance)
                            watch.race_status = "FINISHED"
                            watch.is_simulating = False
                    except Exception:
                        pass
                elif resp.status == 403:
                    watch.error_message = "Anti-Triche / Non engagé (403)"
                elif resp.status == 429:
                    watch.error_message = "Rate Limited (429)"
                else:
                    watch.error_message = f"HTTP {resp.status}"
        except Exception as e:
            watch.error_message = f"Err: {str(e)[:30]}"
