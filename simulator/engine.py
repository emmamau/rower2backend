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

    async def claim_race_pin(self, watch_id: int, race_pin: str) -> Dict[str, Any]:
        """Claims a 5-character race/ticket pin via POST /api/garmin/claim-ticket"""
        await self.init_session()
        watch = self.store.get_watch(watch_id)
        if not watch:
            return {"success": False, "message": "Montre introuvable"}

        clean_pin = race_pin.strip().upper()
        url = f"{self.store.backend_url}/api/garmin/claim-ticket"
        payload = {
            "ticketPin": clean_pin,
            "pin": clean_pin,
            "deviceId": watch.device_id,
            "userId": watch.user_id or watch.device_id,
            "userName": watch.user_name or f"Rameur_{watch.id:02d}",
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

                if resp.status == 200 and data.get("success"):
                    if data.get("deviceToken") and not watch.device_token:
                        watch.device_token = data.get("deviceToken")
                        watch.is_paired = True
                    if data.get("userId") and not watch.user_id:
                        watch.user_id = data.get("userId")
                    if (data.get("userName") or data.get("guestName")) and not watch.user_name:
                        watch.user_name = data.get("userName") or data.get("guestName")

                    watch.race_id = data.get("raceId") or data.get("roomId") or clean_pin
                    watch.race_pin = clean_pin
                    watch.race_mode = "PRIVATE"
                    watch.lane = data.get("lane") or watch.lane
                    watch.race_status = "LOBBY"
                    watch.initial_waiting_sent = False
                    watch.last_poll_timestamp = 0.0
                    watch.error_message = None
                    self.store.save()
                    return {"success": True, "message": f"Engagé en ligne {watch.lane} !", "data": data}
                else:
                    msg = data.get("message") or data.get("error") or f"Erreur HTTP {resp.status}"
                    watch.error_message = msg
                    return {"success": False, "message": msg}
        except Exception as e:
            msg = f"Échec de l'engagement: {str(e)}"
            watch.error_message = msg
            return {"success": False, "message": msg}

    async def join_public_race(self, watch_id: int) -> Dict[str, Any]:
        """Joins the current/next public hourly race"""
        await self.init_session()
        watch = self.store.get_watch(watch_id)
        if not watch:
            return {"success": False, "message": "Montre introuvable"}

        # 1. Fetch current public race
        curr_url = f"{self.store.backend_url}/api/v1/races/current"
        next_url = f"{self.store.backend_url}/api/race/next"
        race_id = None
        target_dist = 2000

        try:
            async with self.session.get(curr_url) as resp:
                if resp.status == 200:
                    d = await resp.json()
                    r = d.get("race") or {}
                    race_id = r.get("id")
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

                watch.race_id = race_id
                watch.race_mode = "PUBLIC"
                watch.race_status = "LOBBY"
                watch.target_distance = target_dist
                watch.initial_waiting_sent = False
                watch.last_poll_timestamp = 0.0
                watch.error_message = None
                self.store.save()
                return {"success": True, "message": f"Engagé sur la course publique {race_id} !", "data": data}
        except Exception as e:
            # Fallback direct: set to lobby ready for public
            watch.race_id = race_id
            watch.race_mode = "PUBLIC"
            watch.race_status = "LOBBY"
            watch.initial_waiting_sent = False
            watch.last_poll_timestamp = 0.0
            self.store.save()
            return {"success": True, "message": f"Assigné à la course publique {race_id}"}

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

    async def start_all(self, watch_ids: Optional[List[int]] = None):
        await self.init_session()
        self.running = True
        if watch_ids is not None:
            targets = [wid for wid in watch_ids if self.store.get_watch(wid) and self.store.get_watch(wid).is_enabled]
        else:
            targets = [w.id for w in self.store.get_enabled_watches()]
        for wid in targets:
            await self.start_watch_simulation(wid)

    async def stop_all(self):
        self.running = False
        for wid in list(self.watch_tasks.keys()):
            await self.stop_watch_simulation(wid)

    async def reset_all(self, watch_ids: Optional[List[int]] = None):
        targets = watch_ids if watch_ids is not None else list(self.store.watches.keys())
        for wid in targets:
            await self.stop_watch_simulation(wid)
            w = self.store.get_watch(wid)
            if w:
                w.reset_race()
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
                    # Cool-down state, send 1 packet every 5 seconds or sleep
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

    async def _handle_waiting_state(self, watch: VirtualWatch):
        """Polls race status at a throttled interval (3s in lobby, 1s in final 5s countdown) and sends initial readiness once."""
        if not watch.race_id:
            # Nothing to wait for yet
            await asyncio.sleep(1.0)
            return

        now = time.time()
        # Send a single 0m telemetry packet once when entering the starting line
        if watch.is_simulating and watch.race_id and not getattr(watch, "initial_waiting_sent", False):
            watch.initial_waiting_sent = True
            await self._send_telemetry(watch, status="waiting", dt=0.0)
            if watch.race_status == "RUNNING":
                return

        # Adaptive polling interval: 1.0s when countdown <= 5s, otherwise 3.0s
        cd = getattr(watch, "countdown_remaining", None)
        poll_interval = 1.0 if (watch.race_status == "COUNTDOWN" and cd is not None and cd <= 5) else 3.0
        last_poll = getattr(watch, "last_poll_timestamp", 0.0)
        if now - last_poll < poll_interval:
            return
        watch.last_poll_timestamp = now

        # Poll race status from backend
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
                    st = race.get("internalStatus") or race.get("status") or data.get("status")
                    if race.get("targetDistance"):
                        watch.target_distance = int(race.get("targetDistance"))

                    sec_rem = data.get("secondsRemaining") if data.get("secondsRemaining") is not None else data.get("countdownSeconds")
                    if isinstance(sec_rem, (int, float)):
                        watch.countdown_remaining = int(sec_rem)

                    if st == "RUNNING" or st == "in_progress":
                        watch.race_status = "RUNNING"
                        watch.elapsed_time = 0.0
                        watch.current_distance = 0.0
                    elif st in ("COUNTDOWN", "countdown"):
                        watch.race_status = "COUNTDOWN"
                    elif st in ("LOBBY", "waiting"):
                        watch.race_status = "LOBBY"
        except Exception:
            pass

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

        # Si le statut est finished ou si la montre a atteint la distance cible, forcer la distance exacte
        send_dist = float(watch.target_distance) if (status == "finished" or watch.current_distance >= watch.target_distance) else watch.current_distance

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
            "instantPower": round(watch.current_power),
            "instantPace": round(watch.current_split),
            "strokeRate": round(watch.current_spm, 1),
            "spm": round(watch.current_spm, 1),
            "status": status,
            "targetDistance": watch.target_distance,
            "metrics": {
                "distanceM": round(send_dist),
                "splitSec": round(watch.current_split),
                "powerWatts": round(watch.current_power),
                "strokeRate": round(watch.current_spm, 1),
                "spm": round(watch.current_spm, 1),
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
                        if server_st == "RUNNING" and watch.race_status in ("LOBBY", "COUNTDOWN"):
                            watch.race_status = "RUNNING"

                        # Synchronisation bidirectionnelle avec la distance officielle normalisée du serveur
                        server_dist = data.get("normDistM")
                        if server_dist is not None and isinstance(server_dist, (int, float)):
                            if server_dist > watch.current_distance:
                                watch.current_distance = float(server_dist)

                        # Si le serveur confirme que le coureur a fini OU si la montre a atteint l'objectif
                        if data.get("isFinished") or watch.current_distance >= watch.target_distance:
                            watch.current_distance = float(watch.target_distance)
                            watch.race_status = "FINISHED"
                            watch.is_simulating = False
                    except Exception:
                        pass
                elif resp.status == 403:
                    watch.error_message = "Anti-Triche Bloqué (403)"
                elif resp.status == 429:
                    watch.error_message = "Rate Limited (429)"
                else:
                    watch.error_message = f"HTTP {resp.status}"
        except Exception as e:
            watch.error_message = f"Err: {str(e)[:30]}"
