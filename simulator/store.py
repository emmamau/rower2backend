import json
import math
import os
from typing import Dict, List, Optional, Any

GARMIN_MODELS = [
    "Garmin Forerunner 965",
    "Garmin Fénix 7 Pro Solar",
    "Garmin Epix Pro (Gen 2)",
    "Garmin Enduro 3",
    "Garmin Forerunner 265",
    "Garmin Venu 3",
    "Garmin Fénix 8 AMOLED",
    "Garmin Forerunner 955",
    "Garmin Instinct 2X Solar",
    "Garmin Tactix 7 AMOLED",
]

ROWER_MODELS = [
    "Concept2 RowErg PM5",
    "Concept2 PM5 FTMS",
    "WaterRower S4 ComModule",
    "Concept2 RowErg PM5 (Bluetooth FTMS)",
    "SmartRow Ergometer",
]

PACE_PROFILES = {
    "elite": {
        "name": "Élite (1:35 / 500m - 350W)",
        "split": 95.0,
        "power": 350,
        "spm": 32.0,
    },
    "advanced": {
        "name": "Avancé (1:50 / 500m - 250W)",
        "split": 110.0,
        "power": 250,
        "spm": 28.0,
    },
    "intermediate": {
        "name": "Intermédiaire (2:05 / 500m - 180W)",
        "split": 125.0,
        "power": 180,
        "spm": 24.0,
    },
    "recreational": {
        "name": "Loisir (2:20 / 500m - 135W)",
        "split": 140.0,
        "power": 135,
        "spm": 21.0,
    },
}

def split_to_watts(split_sec: float) -> int:
    """Official Concept2 formula: Power = 2.80 / (split/500)^3"""
    if split_sec <= 0:
        return 0
    ratio = split_sec / 500.0
    return max(10, min(1200, round(2.80 / (ratio * ratio * ratio))))

def watts_to_split(watts: float) -> float:
    """Official Concept2 formula: v = (watts / 2.80)^(1/3), split = 500 / v"""
    if watts <= 0:
        return 360.0
    v = math.pow(watts / 2.80, 1.0 / 3.0)
    return round(500.0 / v, 1)

class VirtualWatch:
    def __init__(self, watch_id: int):
        self.id = watch_id
        self.device_id = f"SIM_GARMIN_{watch_id:02d}"
        self.watch_model = GARMIN_MODELS[(watch_id - 1) % len(GARMIN_MODELS)]
        self.rower_model = ROWER_MODELS[(watch_id - 1) % len(ROWER_MODELS)]

        # Identity
        self.user_id: Optional[str] = None
        self.user_name: Optional[str] = None
        self.device_token: Optional[str] = None
        self.is_paired: bool = False

        # Race engagement
        self.race_id: Optional[str] = None
        self.race_mode: Optional[str] = None  # "PUBLIC", "PRIVATE", "DUEL"
        self.race_pin: Optional[str] = None
        self.lane: int = watch_id
        self.race_status: str = "IDLE"  # "IDLE", "LOBBY", "COUNTDOWN", "RUNNING", "FINISHED"
        self.target_distance: int = 2000

        # Physical pace settings
        self.target_split: float = 120.0  # 2:00.0 / 500m
        self.target_power: int = split_to_watts(120.0)

        # Real-time state
        self.current_distance: float = 0.0
        self.elapsed_time: float = 0.0
        self.stroke_count: int = 0
        self.current_power: float = float(self.target_power)
        self.current_split: float = self.target_split
        self.current_spm: float = 24.0
        self.current_hr: int = 135
        self.is_simulating: bool = False

        # Diagnostics & HTTP status
        self.last_http_code: Optional[int] = None
        self.last_rtt_ms: Optional[float] = None
        self.last_sync_timestamp: float = 0.0
        self.error_message: Optional[str] = None

    def set_pace(self, split_sec: float):
        self.target_split = max(60.0, min(300.0, round(split_sec, 1)))
        self.target_power = split_to_watts(self.target_split)

    def set_power(self, watts: int):
        self.target_power = max(50, min(1000, watts))
        self.target_split = watts_to_split(self.target_power)

    def reset_race(self):
        self.current_distance = 0.0
        self.elapsed_time = 0.0
        self.stroke_count = 0
        self.current_power = float(self.target_power)
        self.current_split = self.target_split
        self.current_spm = 24.0
        self.current_hr = 132
        self.race_status = "IDLE"
        self.is_simulating = False
        self.error_message = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "device_id": self.device_id,
            "watch_model": self.watch_model,
            "rower_model": self.rower_model,
            "user_id": self.user_id,
            "user_name": self.user_name,
            "device_token": self.device_token,
            "is_paired": self.is_paired,
            "race_id": self.race_id,
            "race_mode": self.race_mode,
            "race_pin": self.race_pin,
            "lane": self.lane,
            "race_status": self.race_status,
            "target_distance": self.target_distance,
            "target_split": self.target_split,
            "target_power": self.target_power,
            "current_distance": round(self.current_distance, 1),
            "elapsed_time": round(self.elapsed_time, 1),
            "stroke_count": self.stroke_count,
            "current_power": round(self.current_power),
            "current_split": round(self.current_split, 1),
            "current_spm": round(self.current_spm, 1),
            "current_hr": self.current_hr,
            "is_simulating": self.is_simulating,
            "last_http_code": self.last_http_code,
            "last_rtt_ms": round(self.last_rtt_ms, 1) if self.last_rtt_ms is not None else None,
            "error_message": self.error_message,
        }

    def update_from_dict(self, data: Dict[str, Any]):
        if "user_id" in data: self.user_id = data["user_id"]
        if "user_name" in data: self.user_name = data["user_name"]
        if "device_token" in data: self.device_token = data["device_token"]
        if "is_paired" in data: self.is_paired = data["is_paired"]
        if "target_split" in data: self.set_pace(float(data["target_split"]))
        if "target_power" in data: self.set_power(int(data["target_power"]))
        if "race_pin" in data: self.race_pin = data["race_pin"]
        if "race_id" in data: self.race_id = data["race_id"]
        if "target_distance" in data: self.target_distance = int(data["target_distance"])

class SimulatorStore:
    def __init__(self, count: int = 30, filepath: str = "simulator/virtual_watches.json"):
        self.count = count
        self.filepath = filepath
        self.backend_url: str = "http://localhost:3000"
        self.load_test_key: Optional[str] = None
        self.spoof_garmin_signature: bool = False
        self.watches: Dict[int, VirtualWatch] = {i: VirtualWatch(i) for i in range(1, count + 1)}
        self.load()

    def get_watch(self, watch_id: int) -> Optional[VirtualWatch]:
        return self.watches.get(watch_id)

    def get_all_watches(self) -> List[VirtualWatch]:
        return [self.watches[i] for i in range(1, self.count + 1)]

    def apply_profile(self, watch_id: Optional[int], profile_key: str):
        if profile_key == "peloton":
            # Natural distribution from elite to recreational across all 30 watches
            for i, w in self.watches.items():
                # Linearly interpolate between 1:38 (98s) and 2:22 (142s)
                ratio = (i - 1) / max(1, self.count - 1)
                split = 98.0 + (142.0 - 98.0) * ratio
                w.set_pace(split)
            self.save()
            return

        profile = PACE_PROFILES.get(profile_key)
        if not profile:
            return

        if watch_id is not None:
            w = self.get_watch(watch_id)
            if w:
                w.set_pace(profile["split"])
        else:
            for w in self.watches.values():
                w.set_pace(profile["split"])
        self.save()

    def save(self):
        try:
            data = {
                "backend_url": self.backend_url,
                "load_test_key": self.load_test_key,
                "spoof_garmin_signature": self.spoof_garmin_signature,
                "watches": {
                    str(w.id): {
                        "user_id": w.user_id,
                        "user_name": w.user_name,
                        "device_token": w.device_token,
                        "is_paired": w.is_paired,
                        "target_split": w.target_split,
                        "target_power": w.target_power,
                        "race_pin": w.race_pin,
                        "race_id": w.race_id,
                        "target_distance": w.target_distance,
                    }
                    for w in self.watches.values()
                }
            }
            os.makedirs(os.path.dirname(self.filepath), exist_ok=True)
            with open(self.filepath, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"[SimulatorStore] Save error: {e}")

    def load(self):
        if not os.path.exists(self.filepath):
            # Apply default peloton distribution
            self.apply_profile(None, "peloton")
            return
        try:
            with open(self.filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
            if "backend_url" in data and data["backend_url"]:
                self.backend_url = data["backend_url"]
            if "load_test_key" in data:
                self.load_test_key = data["load_test_key"]
            if "spoof_garmin_signature" in data:
                self.spoof_garmin_signature = bool(data["spoof_garmin_signature"])
            saved_watches = data.get("watches", {})
            for str_id, w_data in saved_watches.items():
                w_id = int(str_id)
                if w_id in self.watches:
                    self.watches[w_id].update_from_dict(w_data)
        except Exception as e:
            print(f"[SimulatorStore] Load error: {e}")
