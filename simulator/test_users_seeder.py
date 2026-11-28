import argparse
import asyncio
from typing import Dict, Any, List
import aiohttp
from store import SimulatorStore

# 30 identités réalistes : index pair -> M, index impair -> F (cohérent avec le sexe envoyé)
REAL_IDENTITIES = {
    1: ("Léa", "Martin"), 2: ("Lucas", "Bernard"), 3: ("Emma", "Dubois"), 4: ("Hugo", "Thomas"),
    5: ("Chloé", "Robert"), 6: ("Louis", "Richard"), 7: ("Manon", "Petit"), 8: ("Gabriel", "Durand"),
    9: ("Camille", "Leroy"), 10: ("Arthur", "Moreau"), 11: ("Inès", "Simon"), 12: ("Jules", "Laurent"),
    13: ("Sarah", "Lefebvre"), 14: ("Raphaël", "Michel"), 15: ("Jade", "Garcia"), 16: ("Nathan", "David"),
    17: ("Louise", "Bertrand"), 18: ("Adam", "Roux"), 19: ("Alice", "Vincent"), 20: ("Maxime", "Fournier"),
    21: ("Juliette", "Morel"), 22: ("Théo", "Girard"), 23: ("Clara", "André"), 24: ("Antoine", "Lefèvre"),
    25: ("Océane", "Mercier"), 26: ("Paul", "Dupont"), 27: ("Margaux", "Lambert"), 28: ("Tom", "Bonnet"),
    29: ("Pauline", "François"), 30: ("Baptiste", "Martinez"),
}

def build_plus_numbered_email(base_email: str, index: int) -> str:
    """
    Transforms a base email like 'emmanuel.maurice@gmail.com' (or 'emmanuel.maurice+01@gmail.com')
    into 'emmanuel.maurice+01@gmail.com' for index=1, 'emmanuel.maurice+02@gmail.com' for index=2, etc.
    """
    clean = (base_email or "emmanuel.maurice@gmail.com").strip().lower()
    if "@" not in clean:
        clean = f"{clean}@gmail.com"
    local_part, domain = clean.split("@", 1)
    # Strip any existing '+...' suffix from the local part so user can paste either base or +01 email
    base_local = local_part.split("+", 1)[0].strip() or "emmanuel.maurice"
    domain = domain.strip() or "gmail.com"
    return f"{base_local}+{index:02d}@{domain}"


async def seed_and_pair_test_users(
    store: SimulatorStore,
    count: int = 30,
    common_password: str = "RowerTest2026!",
    login_prefix: str = "test_runner_",
    base_email: str = "emmanuel.maurice@gmail.com",
    only_enabled: bool = False,
    real_names: bool = False
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
    clean_base_email = (base_email or "emmanuel.maurice@gmail.com").strip()

    target_count = max(1, min(store.count, count))

    async with aiohttp.ClientSession(timeout=timeout) as session:
        for i in range(1, target_count + 1):
            watch = store.get_watch(i)
            if not watch:
                continue
            if only_enabled and not watch.is_enabled:
                continue

            login = f"{prefix}{i:02d}"
            email = build_plus_numbered_email(clean_base_email, i)
            first_name = "Rameur"
            last_name = f"Test {i:02d}"
            if real_names and i in REAL_IDENTITIES:
                first_name, last_name = REAL_IDENTITIES[i]

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
                        watch.user_name = f"{first_name} {last_name}" if real_names else f"{first_name} {i:02d}"
                        watch.device_token = dev_token
                        watch.is_paired = True
                        watch.error_message = None
                        paired_count += 1
                    else:
                        errors.append(f"Montre {i}: appairage HTTP {p_resp.status}")
            except Exception as e:
                errors.append(f"Montre {i}: validation appairage échouée ({e})")

    store.save()
    sample_email = build_plus_numbered_email(clean_base_email, 1)
    return {
        "success": paired_count > 0,
        "paired_count": paired_count,
        "total": target_count,
        "password": pwd,
        "prefix": prefix,
        "base_email": clean_base_email,
        "errors": errors[:5],
        "message": f"{paired_count} / {target_count} montres appairées avec succès (email : {sample_email}..., mot de passe : {pwd}) !"
    }


async def reset_and_recreate_test_users(
    store: SimulatorStore,
    admin_login: str,
    admin_password: str,
    count: int = 30,
    common_password: str = "RowerTest2026!",
    login_prefix: str = "test_runner_",
    base_email: str = "emmanuel.maurice@gmail.com",
    only_enabled: bool = False,
    real_names: bool = False
) -> Dict[str, Any]:
    """
    Deletes every simulator test account (via the admin API), clears the local watch pairings,
    then recreates all accounts and re-pairs every virtual watch.
    """
    backend_url = store.backend_url
    prefix = (login_prefix or "test_runner_").strip()
    target_count = max(1, min(store.count, count))
    timeout = aiohttp.ClientTimeout(total=15.0)
    errors: List[str] = []
    deleted = 0
    not_found = 0

    # 1. Admin authentication
    admin_token = None
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(f"{backend_url}/api/user/login", json={"login": admin_login, "password": admin_password}) as resp:
                if resp.status == 200:
                    d = await resp.json()
                    admin_token = d.get("token") or (d.get("user") or {}).get("token")
            if not admin_token:
                return {"success": False, "message": "Connexion admin refusée : suppression annulée (aucun compte modifié).", "errors": []}

            headers = {"Authorization": f"Bearer {admin_token}"}
            if store.load_test_key:
                headers["x-load-test-key"] = store.load_test_key

            # 2. Delete accounts (this also removes server-side watch pairings)
            for i in range(1, target_count + 1):
                login = f"{prefix}{i:02d}"
                if login.lower() == admin_login.lower():
                    continue
                try:
                    async with session.delete(f"{backend_url}/api/admin/users/{login}", headers=headers) as dresp:
                        if dresp.status == 200:
                            deleted += 1
                        elif dresp.status == 404:
                            not_found += 1
                        else:
                            errors.append(f"Suppression {login}: HTTP {dresp.status}")
                except Exception as e:
                    errors.append(f"Suppression {login}: {e}")
    except Exception as e:
        return {"success": False, "message": f"Erreur suppression : {e}", "errors": [str(e)]}

    # 3. Clear local pairing state
    for i in range(1, target_count + 1):
        w = store.get_watch(i)
        if not w:
            continue
        if only_enabled and not w.is_enabled:
            continue
        w.user_id = None
        w.user_name = None
        w.device_token = None
        w.is_paired = False
        w.is_simulating = False
    store.save()

    # 4. Recreate accounts and re-pair
    res = await seed_and_pair_test_users(
        store, count=count, common_password=common_password,
        login_prefix=login_prefix, base_email=base_email,
        only_enabled=only_enabled, real_names=real_names
    )
    res["deleted"] = deleted
    res["not_found"] = not_found
    res["errors"] = (errors + res.get("errors", []))[:8]
    res["message"] = f"{deleted} comptes supprimés ({not_found} absents). " + res["message"]
    return res

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed test users with common password and auto-pair virtual watches")
    parser.add_argument("--count", type=int, default=30, help="Number of test users to create (1-30)")
    parser.add_argument("--password", type=str, default="RowerTest2026!", help="Common password for test users")
    parser.add_argument("--prefix", type=str, default="test_runner_", help="Login prefix (e.g. test_runner_)")
    parser.add_argument("--email", type=str, default="emmanuel.maurice@gmail.com", help="Base email (generates base+01@domain, base+02@domain, ...)")
    parser.add_argument("--real-names", action="store_true", help="Use realistic first/last names")
    parser.add_argument("--backend", type=str, default=None, help="Target backend URL override")
    args = parser.parse_args()

    st = SimulatorStore()
    if args.backend:
        st.backend_url = args.backend.rstrip("/")

    print(f"Création de {args.count} comptes sur {st.backend_url} avec l'email '{args.email}' (+XX) et le mot de passe '{args.password}'...")
    res = asyncio.run(seed_and_pair_test_users(st, count=args.count, common_password=args.password, login_prefix=args.prefix, base_email=args.email, real_names=args.real_names))
    print(res["message"])
    if res["errors"]:
        print("Erreurs rencontrées:", res["errors"])
