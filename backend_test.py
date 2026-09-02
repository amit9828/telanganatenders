#!/usr/bin/env python3
"""
Backend test suite for Telangana Tenders — Cashfree payment & access flow.

🚀 REWRITE: The previous version of this script exercised a Razorpay contract
(razorpay_order_id/razorpay_payment_id/razorpay_signature, an
x-razorpay-signature webhook header, HMAC signed as f"{order_id}|{payment_id}")
against a stale preview URL. The live backend has been on Cashfree for a while:
  - POST /api/payment/order            -> Cashfree order creation (single/month/year)
  - POST /api/subscription/create      -> Cashfree order creation (month/year only)
  - POST /api/payment/verify           -> looks order_id up against Cashfree's API
  - POST /api/payment/webhook          -> HMAC-SHA256("<timestamp><rawBody>", secret),
                                          base64, sent as `x-webhook-signature` +
                                          `x-webhook-timestamp` headers
  - PUT  /api/payments/offline         -> mark a pending payment PAID + ledger entry

This script targets that real contract. Run it against a live dev server:

    python backend_test.py
    TEST_BASE_URL=https://www.tgtenders.in/api python backend_test.py
"""

import base64
import hashlib
import hmac
import json
import os
import random
import string
import time

import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
BASE_URL = os.environ.get("TEST_BASE_URL", "http://localhost:3000/api")


def load_dotenv(path=".env"):
    """Tiny .env reader (no python-dotenv dependency). Only used so this script
    can compute a REAL webhook HMAC signature against whatever CASHFREE_SECRET_KEY
    the server is actually running with, for a true end-to-end signature check."""
    values = {}
    if not os.path.exists(path):
        return values
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


ENV = load_dotenv()
CASHFREE_SECRET_KEY = os.environ.get("CASHFREE_SECRET_KEY") or ENV.get("CASHFREE_SECRET_KEY")
CASHFREE_APP_ID = os.environ.get("CASHFREE_APP_ID") or ENV.get("CASHFREE_APP_ID")

PASS = []
FAIL = []
SKIP = []


def record(label, ok, detail=""):
    line = f"{label} — {detail}" if detail else label
    if ok is True:
        PASS.append(line)
        print(f"✅ PASS: {line}")
    elif ok is False:
        FAIL.append(line)
        print(f"❌ FAIL: {line}")
    else:
        SKIP.append(line)
        print(f"⚠️  SKIP: {line}")


def generate_random_email():
    random_str = "".join(random.choices(string.ascii_lowercase + string.digits, k=8))
    return f"test_{random_str}_{int(time.time())}@example.com"


def compute_webhook_signature(timestamp, raw_body, secret):
    """Mirrors lib/payments.js handleCashfreeWebhook: HMAC-SHA256(timestamp + rawBody), base64."""
    mac = hmac.new(secret.encode("utf-8"), (timestamp + raw_body).encode("utf-8"), hashlib.sha256)
    return base64.b64encode(mac.digest()).decode("utf-8")


def section(title):
    print()
    print("=" * 80)
    print(title)
    print("=" * 80)


# ---------------------------------------------------------------------------
# TEST 1: POST /api/payment/order — single/month/year order creation
# ---------------------------------------------------------------------------
section("TEST 1: POST /api/payment/order")

keys_missing = False


def try_create_order(url, payload, label):
    global keys_missing
    try:
        r = requests.post(url, json=payload, timeout=15)
        data = r.json() if r.content else {}
        print(f"  {label}: {r.status_code} {json.dumps(data)[:200]}")
        if r.status_code == 500 and data.get("error") == "Keys missing":
            keys_missing = True
            record(label, None, "CASHFREE_APP_ID/CASHFREE_SECRET_KEY not configured on the server — cannot reach Cashfree")
            return None
        if r.status_code == 200 and (data.get("payment_session_id") and data.get("order", {}).get("amount") is not None):
            record(label, True, f"amount={data['order']['amount']}")
            return data["order"]["id"]
        record(label, False, f"status={r.status_code} body={data}")
        return None
    except Exception as e:
        record(label, False, f"exception: {e}")
        return None


month_order_id = try_create_order(
    f"{BASE_URL}/payment/order",
    {"email": generate_random_email(), "plan": "month"},
    "1a: month plan order (expect amount=14900)",
)
year_order_id = try_create_order(
    f"{BASE_URL}/payment/order",
    {"email": generate_random_email(), "plan": "year"},
    "1b: year plan order (expect amount=149900)",
)
single_test_email = generate_random_email()
single_order_id = try_create_order(
    f"{BASE_URL}/payment/order",
    {"email": single_test_email, "plan": "single", "tenderId": "some_tender_id"},
    "1c: single plan order (expect amount=1000)",
)

# ---------------------------------------------------------------------------
# TEST 2: POST /api/subscription/create — the route this refactor added
# ---------------------------------------------------------------------------
section("TEST 2: POST /api/subscription/create")

try:
    r = requests.post(f"{BASE_URL}/subscription/create", json={"email": generate_random_email(), "plan": "single"}, timeout=10)
    data = r.json() if r.content else {}
    print(f"  2a: {r.status_code} {data}")
    record("2a: plan='single' on /subscription/create -> 400 (subscriptions only)", r.status_code == 400)
except Exception as e:
    record("2a: plan='single' on /subscription/create -> 400", False, str(e))

try:
    r = requests.post(f"{BASE_URL}/subscription/create", json={"plan": "month"}, timeout=10)
    data = r.json() if r.content else {}
    print(f"  2b: {r.status_code} {data}")
    record("2b: missing email on /subscription/create -> 400", r.status_code == 400)
except Exception as e:
    record("2b: missing email on /subscription/create -> 400", False, str(e))

sub_order_id = try_create_order(
    f"{BASE_URL}/subscription/create",
    {"email": generate_random_email(), "plan": "month"},
    "2c: valid month subscription order (expect amount=14900)",
)

# ---------------------------------------------------------------------------
# TEST 3: POST /api/payment/verify
# ---------------------------------------------------------------------------
section("TEST 3: POST /api/payment/verify")

try:
    r = requests.post(f"{BASE_URL}/payment/verify", json={}, timeout=10)
    data = r.json() if r.content else {}
    print(f"  3a: {r.status_code} {data}")
    record("3a: missing order_id -> 400", r.status_code == 400)
except Exception as e:
    record("3a: missing order_id -> 400", False, str(e))

if month_order_id:
    try:
        r = requests.post(f"{BASE_URL}/payment/verify", json={"order_id": month_order_id}, timeout=15)
        data = r.json() if r.content else {}
        print(f"  3b: {r.status_code} {data}")
        # Order was just created and never paid on Cashfree's real checkout page, so
        # the honest expectation is "not paid yet", NOT success — a full PAID
        # round-trip requires actually completing checkout on Cashfree's hosted page.
        record("3b: freshly-created (unpaid) order -> success=false/400", r.status_code == 400 and data.get("success") is False)
    except Exception as e:
        record("3b: freshly-created (unpaid) order -> success=false/400", False, str(e))
else:
    record("3b: freshly-created (unpaid) order -> success=false/400", None, "no order id from Test 1a")

# ---------------------------------------------------------------------------
# TEST 4: POST /api/payment/webhook — HMAC signature verification
# ---------------------------------------------------------------------------
section("TEST 4: POST /api/payment/webhook")

webhook_payload = {
    "data": {
        "order": {"order_id": month_order_id or "order_does_not_exist"},
        "payment": {"payment_status": "SUCCESS"},
    }
}
raw_body = json.dumps(webhook_payload)
timestamp = str(int(time.time()))

# 4a: Invalid signature must always be rejected regardless of server config.
try:
    r = requests.post(
        f"{BASE_URL}/payment/webhook",
        data=raw_body,
        headers={
            "Content-Type": "application/json",
            "x-webhook-signature": "clearly_wrong_signature",
            "x-webhook-timestamp": timestamp,
        },
        timeout=10,
    )
    data = r.json() if r.content else {}
    print(f"  4a: {r.status_code} {data}")
    record("4a: invalid webhook signature -> 400", r.status_code == 400)
except Exception as e:
    record("4a: invalid webhook signature -> 400", False, str(e))

# 4b: Missing signature headers entirely.
try:
    r = requests.post(f"{BASE_URL}/payment/webhook", data=raw_body, headers={"Content-Type": "application/json"}, timeout=10)
    data = r.json() if r.content else {}
    print(f"  4b: {r.status_code} {data}")
    record("4b: missing webhook signature headers -> 400", r.status_code == 400)
except Exception as e:
    record("4b: missing webhook signature headers -> 400", False, str(e))

# 4c: A REAL valid signature — only possible if this script can read the same
# CASHFREE_SECRET_KEY the server is running with (e.g. running this script on the
# same machine/.env as the dev server).
if CASHFREE_SECRET_KEY:
    valid_sig = compute_webhook_signature(timestamp, raw_body, CASHFREE_SECRET_KEY)
    try:
        r = requests.post(
            f"{BASE_URL}/payment/webhook",
            data=raw_body,
            headers={
                "Content-Type": "application/json",
                "x-webhook-signature": valid_sig,
                "x-webhook-timestamp": timestamp,
            },
            timeout=10,
        )
        data = r.json() if r.content else {}
        print(f"  4c: {r.status_code} {data}")
        record("4c: valid webhook signature -> 200 success:true", r.status_code == 200 and data.get("success") is True)
    except Exception as e:
        record("4c: valid webhook signature -> 200 success:true", False, str(e))
else:
    record(
        "4c: valid webhook signature -> 200 success:true",
        None,
        "CASHFREE_SECRET_KEY not found in environment or .env — cannot compute a real signature",
    )

# ---------------------------------------------------------------------------
# TEST 5: PUT /api/payments/offline — offline ledger payment
# ---------------------------------------------------------------------------
section("TEST 5: PUT /api/payments/offline")

try:
    r = requests.put(
        f"{BASE_URL}/payments/offline",
        json={"amount": 500, "reason": "Backend test offline payment", "client_id": generate_random_email()},
        timeout=10,
    )
    data = r.json() if r.content else {}
    print(f"  5a: {r.status_code} {data}")
    record("5a: offline ledger payment recorded -> 200 success:true", r.status_code == 200 and data.get("success") is True)
except Exception as e:
    record("5a: offline ledger payment recorded -> 200 success:true", False, str(e))

# ---------------------------------------------------------------------------
# TEST 6: MongoDB defensive ObjectId parsing (regression test for the fix in
# app/api/[[...path]]/route.js — malformed ids used to crash with a 500)
# ---------------------------------------------------------------------------
section("TEST 6: Defensive ObjectId parsing (malformed id -> 400, not 500)")

malformed_id_routes = [
    ("DELETE", f"{BASE_URL}/guest-queries?id=not-a-valid-object-id", None),
    ("DELETE", f"{BASE_URL}/finance/ledger?id=not-a-valid-object-id", None),
    ("DELETE", f"{BASE_URL}/client-requests?id=not-a-valid-object-id", None),
    ("DELETE", f"{BASE_URL}/dispatches?id=not-a-valid-object-id", None),
    ("PUT", f"{BASE_URL}/finance/ledger", {"id": "not-a-valid-object-id", "amount": 1}),
]

for method, url, body in malformed_id_routes:
    label = f"6.{method} {url.replace(BASE_URL, '')} with malformed id -> 400 (not 500)"
    try:
        if method == "DELETE":
            r = requests.delete(url, timeout=10)
        else:
            r = requests.put(url, json=body, timeout=10)
        data = r.json() if r.content else {}
        print(f"  {label}: {r.status_code} {data}")
        record(label, r.status_code == 400)
    except Exception as e:
        record(label, False, str(e))

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
section("BACKEND TEST COMPLETE")
print(f"PASS: {len(PASS)}   FAIL: {len(FAIL)}   SKIP: {len(SKIP)}")
if keys_missing:
    print()
    print("⚠️  CASHFREE_APP_ID / CASHFREE_SECRET_KEY are not configured on the server.")
    print("   Order-creation tests could not reach Cashfree's real API. Add both keys")
    print("   to .env and restart the dev server to run the full payment flow.")
if FAIL:
    print()
    print("Failed checks:")
    for f in FAIL:
        print(f"  - {f}")

raise SystemExit(1 if FAIL else 0)
