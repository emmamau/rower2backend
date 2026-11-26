import argparse
import asyncio
from typing import Dict, Any, List
import aiohttp
from store import SimulatorStore

async def seed_and_pair_test_users(
    store: SimulatorStore,
    count: int = 30,
    common_password: str = "RowerTest2026!",
    login_prefix: str = "test_runner_",
    only_enabled: bool = False
) -> Dict[str, Any]:
    """
    Creates test user accounts on the platform (if not already existing) with a common password,
    generates their pairing codes, and automatically pairs the virtual watches.
    """
    backend_url = store.backend_url
    timeout = aiohttp.ClientTimeout(total=10.0)
    paired_count = 0
    errors: List[str] = []
    pwd = (common_password or "RowerTest2026!").strip()
    prefix = (login_prefix or "test_runner_").strip()

    target_count = max(1, min(store.count, count))

    async with aiohttp.ClientSession(timeout=timeout) as session:
        for i in range(1, target_count + 1):
            watch = store.get_watch(i)
            if not watch:
                continue
            if only_enabled and not watch.is_enabled:
                continue

            login = f"{prefix}{i:02d}"
            email = f"{prefix}{i:02d}@testrower.com"
            first_name = "Rameur"
            last_name = f"Test {i:02d}"

            # 1. Register or Login
            token = None
            reg_url = f"{backend_url}/api/user/register"
            reg_payload = {
                "login": login,
                "email": email,
                "password": pwd,
                "prenom": first_name,
                "firstName": first_name,
                "nom": last_name,
                "lastName": last_name,
                "anneeNaissance": 1990 + (i % 15),
                "birthYear": 1990 + (i % 15),
                "sexe": "M" if i % 2 == 0 else "F",
                "gender": "M" if i % 2 == 0 else "F",
                "pays": "FR",
                "country": "FR"
            }

            try:
                async with session.post(reg_url, json=reg_payload) as resp:
                    if resp.status in (200, 201):
                        data = await resp.json()
                        token = data.get("token") or (data.get("user") or {}).get("token")
                    else:
                        # Attempt login if already registered
                        login_url = f"{backend_url}/api/user/login"
                        async with session.post(login_url, json={"login": login, "password": pwd}) as lresp:
                            if lresp.status == 200:
                                ldata = await lresp.json()
                                token = ldata.get("token") or (ldata.get("user") or {}).get("token")
            except Exception as e:
                errors.append(f"Montre {i}: enregistrement échoué ({e})")
                continue

            # 2. Generate 6-character Garmin pairing code for this user
            pair_code_url = f"{backend_url}/api/garmin/pairing-code"
            headers = {
                "Content-Type": "application/json",
                "x-garmin-signature": "CIQ_OFFICIAL_ROWER_V1",
                "x-device-id": watch.device_id
            }
            if store.load_test_key:
                headers["x-load-test-key"] = store.load_test_key
            if token:
                headers["Authorization"] = f"Bearer {token}"

            pairing_code = None
            try:
                async with session.post(pair_code_url, json={"userId": login}, headers=headers) as c_resp:
                    if c_resp.status == 200:
                        c_data = await c_resp.json()
                        pairing_code = c_data.get("pairingCode")
            except Exception as e:
                errors.append(f"Montre {i}: génération code pairing échouée ({e})")
                continue

            if not pairing_code:
                errors.append(f"Montre {i}: code appairage introuvable")
                continue

            # 3. Simulate watch submitting the pairing code
            pair_watch_url = f"{backend_url}/api/garmin/pair"
            try:
                pair_payload = {
                    "pairingCode": pairing_code,
                    "deviceId": watch.device_id
                }
                pair_headers = {
                    "Content-Type": "application/json",
                    "x-garmin-signature": "CIQ_OFFICIAL_ROWER_V1",
                    "x-device-id": watch.device_id
                }
                if store.load_test_key:
                    pair_headers["x-load-test-key"] = store.load_test_key

                async with session.post(pair_watch_url, json=pair_payload, headers=pair_headers) as p_resp:
                    if p_resp.status == 200:
                        p_data = await p_resp.json()
                        dev_token = p_data.get("deviceToken")
                        watch.user_id = login
                        watch.user_name = f"{first_name} {i:02d}"
                        watch.device_token = dev_token
                        watch.is_paired = True
                        watch.error_message = None
                        paired_count += 1
                    else:
                        errors.append(f"Montre {i}: appairage HTTP {p_resp.status}")
            except Exception as e:
                errors.append(f"Montre {i}: validation appairage échouée ({e})")

    store.save()
    return {
        "success": paired_count > 0,
        "paired_count": paired_count,
        "total": target_count,
        "password": pwd,
        "prefix": prefix,
        "errors": errors[:5],
        "message": f"{paired_count} / {target_count} montres appairées avec succès (mot de passe commun : {pwd}) !"
    }

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed test users with common password and auto-pair virtual watches")
    parser.add_argument("--count", type=int, default=30, help="Number of test users to create (1-30)")
    parser.add_argument("--password", type=str, default="RowerTest2026!", help="Common password for test users")
    parser.add_argument("--prefix", type=str, default="test_runner_", help="Login prefix (e.g. test_runner_)")
    parser.add_argument("--backend", type=str, default=None, help="Target backend URL override")
    args = parser.parse_args()

    st = SimulatorStore()
    if args.backend:
        st.backend_url = args.backend.rstrip("/")

    print(f"Création de {args.count} comptes sur {st.backend_url} avec le mot de passe '{args.password}'...")
    res = asyncio.run(seed_and_pair_test_users(st, count=args.count, common_password=args.password, login_prefix=args.prefix))
    print(res["message"])
    if res["errors"]:
        print("Erreurs rencontrées:", res["errors"])
