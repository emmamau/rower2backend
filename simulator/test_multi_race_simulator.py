import asyncio
import unittest
from aiohttp import web

from store import SimulatorStore
from engine import SimulationEngine
from test_users_seeder import build_plus_numbered_email, seed_and_pair_test_users


class TestSimulatorMultiRace(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.room_capacities = {"PIN01": 2, "PIN02": 3}
        self.room_counts = {"PIN01": 0, "PIN02": 0}
        self.room_statuses = {"PRIV_PIN01": "LOBBY", "PRIV_PIN02": "LOBBY"}
        self.ready_calls = []
        self.boost_calls = []

        app = web.Application()
        app.router.add_post("/api/rooms/join", self.handle_room_join)
        app.router.add_post("/api/garmin/claim-ticket", self.handle_room_join)
        app.router.add_post("/api/rooms/{room_id}/status", self.handle_room_status)
        app.router.add_get("/api/v1/races/user-enrolled", self.handle_user_enrolled)
        app.router.add_get("/api/v1/races/private/{race_id}", self.handle_get_private_race)
        app.router.add_post("/api/garmin/boost", self.handle_boost)

        self.runner = web.AppRunner(app)
        await self.runner.setup()
        self.site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await self.site.start()
        port = self.site._server.sockets[0].getsockname()[1]
        self.base_url = f"http://127.0.0.1:{port}"

        self.store = SimulatorStore(count=10, filepath="simulator/test_virtual_watches.json")
        self.store.backend_url = self.base_url
        self.store.auto_sync_on_engage = False
        for i in range(1, 11):
            w = self.store.get_watch(i)
            w.is_enabled = True
            w.is_paired = True
            w.user_id = f"test_runner_{i:02d}"
            w.user_name = f"Rameur {i:02d}"
            w.device_token = f"tok_{i:02d}"

        self.engine = SimulationEngine(self.store)
        await self.engine.init_session()

    async def asyncTearDown(self):
        await self.engine.stop_all()
        await self.engine.close_session()
        await self.runner.cleanup()
        import os
        if os.path.exists("simulator/test_virtual_watches.json"):
            os.remove("simulator/test_virtual_watches.json")

    async def handle_room_join(self, request):
        body = await request.json()
        pin = (body.get("pin") or body.get("code") or "").upper()
        cap = self.room_capacities.get(pin, 5)
        curr = self.room_counts.get(pin, 0)
        if curr >= cap:
            return web.json_response({"success": False, "error": "Salon complet - quota atteint"}, status=409)
        self.room_counts[pin] = curr + 1
        lane = self.room_counts[pin]
        race_id = f"PRIV_{pin}"
        return web.json_response({
            "success": True,
            "raceId": race_id,
            "pinCode": pin,
            "title": f"Course {pin}",
            "lane": lane,
            "targetDistance": 1000,
            "internalStatus": self.room_statuses.get(race_id, "LOBBY"),
            "gameMode": "multi",
        })

    async def handle_room_status(self, request):
        room_id = request.match_info["room_id"]
        body = await request.json()
        self.ready_calls.append((room_id, body.get("userId"), body.get("ready")))
        return web.json_response({
            "success": True,
            "raceId": room_id,
            "internalStatus": self.room_statuses.get(room_id, "LOBBY"),
        })

    async def handle_user_enrolled(self, request):
        user_id = request.query.get("userId", "")
        if user_id == "test_runner_01":
            return web.json_response({
                "success": True,
                "count": 1,
                "enrolledRaces": [{
                    "pinCode": "PIN01",
                    "role": "duel_challenger",
                    "isEngagedOnLane": False,
                    "assignedLane": 1,
                    "race": {
                        "id": "PRIV_PIN01",
                        "pinCode": "PIN01",
                        "code": "abc-def-ghi",
                        "title": "Duel Inscrit 01",
                        "internalStatus": "LOBBY",
                        "targetDistance": 1000,
                        "gameMode": "duel_1v1",
                    }
                }]
            })
        elif user_id == "test_runner_02":
            return web.json_response({
                "success": True,
                "count": 1,
                "enrolledRaces": [{
                    "pinCode": "PIN02",
                    "role": "participant",
                    "isEngagedOnLane": False,
                    "assignedLane": 1,
                    "race": {
                        "id": "PRIV_PIN02",
                        "pinCode": "PIN02",
                        "code": "xyz-uvw-rst",
                        "title": "Salon Inscrit 02",
                        "internalStatus": "LOBBY",
                        "targetDistance": 1000,
                        "gameMode": "multi",
                    }
                }]
            })
        return web.json_response({"success": True, "count": 0, "enrolledRaces": []})

    async def handle_get_private_race(self, request):
        race_id = request.match_info["race_id"]
        st = self.room_statuses.get(race_id, "LOBBY")
        return web.json_response({
            "success": True,
            "internalStatus": st,
            "race": {
                "id": race_id,
                "title": f"Salon {race_id}",
                "internalStatus": st,
                "targetDistance": 1000,
            }
        })

    async def handle_boost(self, request):
        body = await request.json()
        self.boost_calls.append(body)
        race_id = body.get("raceId")
        st = self.room_statuses.get(race_id, "LOBBY")
        return web.json_response({
            "status": st,
            "normDistM": body.get("currentDistance", 0),
            "isFinished": False,
        })

    async def test_distribute_watches_round_robin_with_capacity_overflow(self):
        # PIN01 has capacity 2, PIN02 has capacity 3 -> total capacity 5 for 5 watches
        res = await self.engine.distribute_watches_across_races(
            watch_ids=[1, 2, 3, 4, 5],
            race_targets=["PIN01", "PIN02"],
            mode="round_robin",
            auto_arm=False,
        )
        self.assertTrue(res["success"])
        self.assertEqual(res["engaged_count"], 5)
        self.assertEqual(len(res["distribution"]["PIN01"]), 2)
        self.assertEqual(len(res["distribution"]["PIN02"]), 3)
        # Verify BLE READY was notified for all 5 engaged watches
        self.assertEqual(len(self.ready_calls), 5)

    async def test_auto_engage_enrolled_races(self):
        res1 = await self.engine.auto_engage_watch_enrolled(1, auto_arm=False)
        self.assertTrue(res1["success"])
        self.assertEqual(self.store.get_watch(1).race_pin, "PIN01")

        res2 = await self.engine.auto_engage_watch_enrolled(2, auto_arm=False)
        self.assertTrue(res2["success"])
        self.assertEqual(self.store.get_watch(2).race_pin, "PIN02")

        # Watch 3 has no enrolled race
        res3 = await self.engine.auto_engage_watch_enrolled(3, fallback_public=False, auto_arm=False)
        self.assertFalse(res3["success"])
        self.assertEqual(res3["enrolled_count"], 0)

    async def test_synchronize_telemetry_start_with_race_start(self):
        # Engage watch 1 on PIN01 and watch 2 on PIN02 with auto_arm=True
        await self.engine.claim_race_pin(1, "PIN01", auto_arm=True)
        await self.engine.claim_race_pin(2, "PIN02", auto_arm=True)

        await asyncio.sleep(0.3)
        # While both races are in LOBBY, only initial waiting packets (0W, 0m) are sent
        w1 = self.store.get_watch(1)
        w2 = self.store.get_watch(2)
        self.assertEqual(w1.race_status, "LOBBY")
        self.assertEqual(w2.race_status, "LOBBY")
        self.assertEqual(w1.current_distance, 0.0)
        self.assertEqual(w2.current_distance, 0.0)

        # Now start ONLY race PRIV_PIN01 while PRIV_PIN02 stays in LOBBY
        self.room_statuses["PRIV_PIN01"] = "RUNNING"
        self.engine.race_status_cache.clear()
        w1.last_poll_timestamp = 0.0
        w2.last_poll_timestamp = 0.0

        await asyncio.sleep(1.3)
        self.assertEqual(w1.race_status, "RUNNING")
        self.assertGreater(w1.current_distance, 0.0)
        # Watch 2 must still be waiting in LOBBY at 0m!
        self.assertEqual(w2.race_status, "LOBBY")
        self.assertEqual(w2.current_distance, 0.0)

    def test_build_plus_numbered_email(self):
        self.assertEqual(
            build_plus_numbered_email("emmanuel.maurice@gmail.com", 1),
            "emmanuel.maurice+01@gmail.com",
        )
        self.assertEqual(
            build_plus_numbered_email("emmanuel.maurice@gmail.com", 30),
            "emmanuel.maurice+30@gmail.com",
        )
        # Should also handle when a user inputs an email that already has a +XX tag
        self.assertEqual(
            build_plus_numbered_email("emmanuel.maurice+01@gmail.com", 12),
            "emmanuel.maurice+12@gmail.com",
        )


if __name__ == "__main__":
    unittest.main()
