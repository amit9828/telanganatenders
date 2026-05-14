#!/usr/bin/env python3
"""
Comprehensive backend test for Telangana Tenders payment & access flow
Tests all scenarios from the review request
"""

import requests
import json
import hmac
import hashlib
import time
from datetime import datetime, timedelta
import random
import string

# Configuration
BASE_URL = "https://tenders-telangana.preview.emergentagent.com/api"
RAZORPAY_KEY_SECRET = "ldj30whiIYkDd4FfGCPhEVhT"
RAZORPAY_WEBHOOK_SECRET = "telangana_tenders_123"

def generate_random_email():
    """Generate unique random email for each test"""
    random_str = ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))
    return f"test_{random_str}_{int(time.time())}@example.com"

def compute_signature(order_id, payment_id, secret):
    """Compute HMAC SHA256 signature for Razorpay"""
    message = f"{order_id}|{payment_id}"
    signature = hmac.new(
        secret.encode('utf-8'),
        message.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    return signature

def compute_webhook_signature(body, secret):
    """Compute HMAC SHA256 signature for webhook"""
    signature = hmac.new(
        secret.encode('utf-8'),
        body.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    return signature

print("=" * 80)
print("TELANGANA TENDERS BACKEND TEST - PAYMENT & ACCESS FLOW")
print("=" * 80)
print()

# Test 1: Health check
print("TEST 1: GET /api/health")
print("-" * 80)
try:
    response = requests.get(f"{BASE_URL}/health", timeout=10)
    print(f"Status: {response.status_code}")
    data = response.json()
    print(f"Response: {json.dumps(data, indent=2)}")
    if response.status_code == 200 and data.get('status') == 'ok':
        print("✅ PASS: Health check successful")
    else:
        print("❌ FAIL: Health check failed")
except Exception as e:
    print(f"❌ FAIL: Exception - {str(e)}")
print()

# Test 2: Get tenders list and find Patancheru tender
print("TEST 2: GET /api/tenders?scope=all")
print("-" * 80)
patancheru_tender_id = None
try:
    response = requests.get(f"{BASE_URL}/tenders?scope=all", timeout=10)
    print(f"Status: {response.status_code}")
    data = response.json()
    tenders = data.get('tenders', [])
    print(f"Found {len(tenders)} tenders")
    
    # Find Patancheru tender
    for tender in tenders:
        if 'Patancheru' in tender.get('title', '') or 'Patancheru' in tender.get('district', ''):
            patancheru_tender_id = tender.get('id')
            print(f"Found Patancheru tender: {tender.get('title')}")
            print(f"Tender ID: {patancheru_tender_id}")
            break
    
    if response.status_code == 200 and len(tenders) > 0:
        print("✅ PASS: Tenders list retrieved")
        if patancheru_tender_id:
            print(f"✅ PASS: Found Patancheru tender with ID: {patancheru_tender_id}")
        else:
            # Use first tender if Patancheru not found
            patancheru_tender_id = tenders[0].get('id')
            print(f"⚠️  WARNING: Patancheru tender not found, using first tender: {patancheru_tender_id}")
    else:
        print("❌ FAIL: Failed to retrieve tenders")
except Exception as e:
    print(f"❌ FAIL: Exception - {str(e)}")
print()

# Test 3: Get settings
print("TEST 3: GET /api/settings")
print("-" * 80)
try:
    response = requests.get(f"{BASE_URL}/settings", timeout=10)
    print(f"Status: {response.status_code}")
    data = response.json()
    print(f"Response: {json.dumps(data, indent=2)}")
    if response.status_code == 200 and 'brand_name' in data and 'tagline' in data:
        print("✅ PASS: Settings retrieved successfully")
    else:
        print("❌ FAIL: Settings retrieval failed")
except Exception as e:
    print(f"❌ FAIL: Exception - {str(e)}")
print()

# Test 4: POST /api/payment/order - VALIDATIONS
print("TEST 4: POST /api/payment/order - VALIDATIONS")
print("-" * 80)

# 4a: Missing email
print("4a: {plan:'single'} without email → 400")
try:
    response = requests.post(f"{BASE_URL}/payment/order", json={"plan": "single"}, timeout=10)
    print(f"Status: {response.status_code}")
    data = response.json()
    print(f"Response: {json.dumps(data, indent=2)}")
    if response.status_code == 400:
        print("✅ PASS: Correctly rejected missing email")
    else:
        print("❌ FAIL: Should return 400 for missing email")
except Exception as e:
    print(f"❌ FAIL: Exception - {str(e)}")
print()

# 4b: Missing tenderId for single plan
print("4b: {email, plan:'single'} without tenderId → 400")
test_email = generate_random_email()
try:
    response = requests.post(f"{BASE_URL}/payment/order", json={"email": test_email, "plan": "single"}, timeout=10)
    print(f"Status: {response.status_code}")
    data = response.json()
    print(f"Response: {json.dumps(data, indent=2)}")
    if response.status_code == 400 and 'tenderId required' in data.get('error', ''):
        print("✅ PASS: Correctly rejected missing tenderId for single plan")
    else:
        print("❌ FAIL: Should return 400 with 'tenderId required' message")
except Exception as e:
    print(f"❌ FAIL: Exception - {str(e)}")
print()

# 4c: Invalid plan
print("4c: {email, plan:'foo'} → 400")
test_email = generate_random_email()
try:
    response = requests.post(f"{BASE_URL}/payment/order", json={"email": test_email, "plan": "foo"}, timeout=10)
    print(f"Status: {response.status_code}")
    data = response.json()
    print(f"Response: {json.dumps(data, indent=2)}")
    if response.status_code == 400 and 'Invalid plan' in data.get('error', ''):
        print("✅ PASS: Correctly rejected invalid plan")
    else:
        print("❌ FAIL: Should return 400 with 'Invalid plan' message")
except Exception as e:
    print(f"❌ FAIL: Exception - {str(e)}")
print()

# 4d: Valid month plan
print("4d: {email, plan:'month'} valid → 200, amount=14900")
test_email_month = generate_random_email()
month_order_id = None
try:
    response = requests.post(f"{BASE_URL}/payment/order", json={"email": test_email_month, "plan": "month"}, timeout=10)
    print(f"Status: {response.status_code}")
    data = response.json()
    print(f"Response: {json.dumps(data, indent=2)}")
    if response.status_code == 200:
        order = data.get('order', {})
        month_order_id = order.get('id')
        amount = order.get('amount')
        key_id = data.get('key_id', '')
        print(f"Order ID: {month_order_id}")
        print(f"Amount: {amount} (expected 14900)")
        print(f"Key ID: {key_id}")
        if amount == 14900 and key_id.startswith('rzp_test_'):
            print("✅ PASS: Month plan order created successfully")
        else:
            print(f"❌ FAIL: Amount or key_id incorrect (amount={amount}, key_id={key_id})")
    else:
        print("❌ FAIL: Should return 200 for valid month plan")
except Exception as e:
    print(f"❌ FAIL: Exception - {str(e)}")
print()

# 4e: Valid single plan
print("4e: {email, plan:'single', tenderId} → 200, amount=1000")
test_email_single = generate_random_email()
single_order_id = None
if patancheru_tender_id:
    try:
        response = requests.post(f"{BASE_URL}/payment/order", 
                                json={"email": test_email_single, "plan": "single", "tenderId": patancheru_tender_id}, 
                                timeout=10)
        print(f"Status: {response.status_code}")
        data = response.json()
        print(f"Response: {json.dumps(data, indent=2)}")
        if response.status_code == 200:
            order = data.get('order', {})
            single_order_id = order.get('id')
            amount = order.get('amount')
            print(f"Order ID: {single_order_id}")
            print(f"Amount: {amount} (expected 1000)")
            if amount == 1000:
                print("✅ PASS: Single plan order created successfully")
            else:
                print(f"❌ FAIL: Amount incorrect (amount={amount})")
        else:
            print("❌ FAIL: Should return 200 for valid single plan")
    except Exception as e:
        print(f"❌ FAIL: Exception - {str(e)}")
else:
    print("⚠️  SKIP: No tender ID available")
print()

# 4f: Valid year plan
print("4f: {email, plan:'year'} → 200, amount=149900")
test_email_year = generate_random_email()
year_order_id = None
try:
    response = requests.post(f"{BASE_URL}/payment/order", json={"email": test_email_year, "plan": "year"}, timeout=10)
    print(f"Status: {response.status_code}")
    data = response.json()
    print(f"Response: {json.dumps(data, indent=2)}")
    if response.status_code == 200:
        order = data.get('order', {})
        year_order_id = order.get('id')
        amount = order.get('amount')
        print(f"Order ID: {year_order_id}")
        print(f"Amount: {amount} (expected 149900)")
        if amount == 149900:
            print("✅ PASS: Year plan order created successfully")
        else:
            print(f"❌ FAIL: Amount incorrect (amount={amount})")
    else:
        print("❌ FAIL: Should return 200 for valid year plan")
except Exception as e:
    print(f"❌ FAIL: Exception - {str(e)}")
print()

# Test 5: POST /api/payment/verify - SIGNATURE CHECK
print("TEST 5: POST /api/payment/verify - SIGNATURE CHECK")
print("-" * 80)

# 5a: Valid signature
print("5a: Valid signature → {success: true}")
if month_order_id:
    payment_id = "pay_TEST123"
    valid_signature = compute_signature(month_order_id, payment_id, RAZORPAY_KEY_SECRET)
    print(f"Order ID: {month_order_id}")
    print(f"Payment ID: {payment_id}")
    print(f"Computed signature: {valid_signature}")
    try:
        response = requests.post(f"{BASE_URL}/payment/verify", 
                                json={
                                    "razorpay_order_id": month_order_id,
                                    "razorpay_payment_id": payment_id,
                                    "razorpay_signature": valid_signature,
                                    "email": test_email_month,
                                    "plan": "month"
                                }, 
                                timeout=10)
        print(f"Status: {response.status_code}")
        data = response.json()
        print(f"Response: {json.dumps(data, indent=2)}")
        if response.status_code == 200 and data.get('success') == True:
            print("✅ PASS: Valid signature accepted")
        else:
            print("❌ FAIL: Valid signature should be accepted")
    except Exception as e:
        print(f"❌ FAIL: Exception - {str(e)}")
else:
    print("⚠️  SKIP: No month order ID available")
print()

# 5b: Invalid signature
print("5b: Invalid signature → 400")
if month_order_id:
    payment_id = "pay_TEST456"
    wrong_signature = "wrong_signature_12345"
    try:
        response = requests.post(f"{BASE_URL}/payment/verify", 
                                json={
                                    "razorpay_order_id": month_order_id,
                                    "razorpay_payment_id": payment_id,
                                    "razorpay_signature": wrong_signature,
                                    "email": test_email_month,
                                    "plan": "month"
                                }, 
                                timeout=10)
        print(f"Status: {response.status_code}")
        data = response.json()
        print(f"Response: {json.dumps(data, indent=2)}")
        if response.status_code == 400 and 'Invalid signature' in data.get('error', ''):
            print("✅ PASS: Invalid signature rejected")
        else:
            print("❌ FAIL: Invalid signature should be rejected with 400")
    except Exception as e:
        print(f"❌ FAIL: Exception - {str(e)}")
else:
    print("⚠️  SKIP: No month order ID available")
print()

# Test 6: USER MODEL UPDATES
print("TEST 6: USER MODEL UPDATES")
print("-" * 80)

# 6a: Check user after month purchase
print("6a: GET /api/me after month purchase")
if month_order_id:
    try:
        response = requests.get(f"{BASE_URL}/me?email={test_email_month}", timeout=10)
        print(f"Status: {response.status_code}")
        data = response.json()
        print(f"Response: {json.dumps(data, indent=2)}")
        if response.status_code == 200:
            is_premium = data.get('is_premium')
            premium_expiry = data.get('premium_expiry_date')
            subscription = data.get('subscription', {})
            plan = subscription.get('plan')
            print(f"is_premium: {is_premium}")
            print(f"premium_expiry_date: {premium_expiry}")
            print(f"subscription.plan: {plan}")
            if is_premium and premium_expiry and plan == 'month':
                print("✅ PASS: User model updated correctly after month purchase")
            else:
                print("❌ FAIL: User model not updated correctly")
        else:
            print("❌ FAIL: Failed to get user info")
    except Exception as e:
        print(f"❌ FAIL: Exception - {str(e)}")
else:
    print("⚠️  SKIP: No month order verified")
print()

# 6b: Second month purchase (extension test)
print("6b: Second month purchase for same user (extension test)")
if month_order_id:
    try:
        # Create second order
        response = requests.post(f"{BASE_URL}/payment/order", 
                                json={"email": test_email_month, "plan": "month"}, 
                                timeout=10)
        if response.status_code == 200:
            data = response.json()
            second_order_id = data.get('order', {}).get('id')
            print(f"Second order ID: {second_order_id}")
            
            # Verify second payment
            payment_id_2 = "pay_TEST789"
            signature_2 = compute_signature(second_order_id, payment_id_2, RAZORPAY_KEY_SECRET)
            response = requests.post(f"{BASE_URL}/payment/verify", 
                                    json={
                                        "razorpay_order_id": second_order_id,
                                        "razorpay_payment_id": payment_id_2,
                                        "razorpay_signature": signature_2,
                                        "email": test_email_month,
                                        "plan": "month"
                                    }, 
                                    timeout=10)
            print(f"Verify status: {response.status_code}")
            
            # Check if expiry extended
            response = requests.get(f"{BASE_URL}/me?email={test_email_month}", timeout=10)
            data = response.json()
            new_expiry = data.get('premium_expiry_date')
            print(f"New premium_expiry_date: {new_expiry}")
            
            # Check if expiry is ~60 days from now (allowing some margin)
            if new_expiry:
                expiry_date = datetime.fromisoformat(new_expiry.replace('Z', '+00:00'))
                days_from_now = (expiry_date - datetime.now(expiry_date.tzinfo)).days
                print(f"Days from now: {days_from_now}")
                if 55 <= days_from_now <= 65:  # ~60 days with margin
                    print("✅ PASS: Premium expiry extended correctly (stacked)")
                else:
                    print(f"❌ FAIL: Premium expiry not extended correctly (expected ~60 days, got {days_from_now})")
            else:
                print("❌ FAIL: No premium expiry date found")
        else:
            print("❌ FAIL: Failed to create second order")
    except Exception as e:
        print(f"❌ FAIL: Exception - {str(e)}")
else:
    print("⚠️  SKIP: No month order verified")
print()

# 6c: Single plan purchase
print("6c: Single plan purchase - purchased_tenders array")
if single_order_id and patancheru_tender_id:
    try:
        # Verify single payment
        payment_id_single = "pay_SINGLE123"
        signature_single = compute_signature(single_order_id, payment_id_single, RAZORPAY_KEY_SECRET)
        response = requests.post(f"{BASE_URL}/payment/verify", 
                                json={
                                    "razorpay_order_id": single_order_id,
                                    "razorpay_payment_id": payment_id_single,
                                    "razorpay_signature": signature_single,
                                    "email": test_email_single,
                                    "plan": "single",
                                    "tenderId": patancheru_tender_id
                                }, 
                                timeout=10)
        print(f"Verify status: {response.status_code}")
        
        # Check user model
        response = requests.get(f"{BASE_URL}/me?email={test_email_single}", timeout=10)
        data = response.json()
        print(f"Response: {json.dumps(data, indent=2)}")
        purchased_tenders = data.get('purchased_tenders', [])
        is_premium = data.get('is_premium')
        print(f"purchased_tenders: {purchased_tenders}")
        print(f"is_premium: {is_premium}")
        
        if patancheru_tender_id in purchased_tenders and not is_premium:
            print("✅ PASS: Single plan correctly added to purchased_tenders, is_premium=false")
        else:
            print("❌ FAIL: Single plan not correctly recorded")
    except Exception as e:
        print(f"❌ FAIL: Exception - {str(e)}")
else:
    print("⚠️  SKIP: No single order or tender ID available")
print()

# 6d: Access check for single plan user
print("6d: GET /api/access for single plan user")
if patancheru_tender_id:
    try:
        # Check access to purchased tender
        response = requests.get(f"{BASE_URL}/access?email={test_email_single}&tenderId={patancheru_tender_id}", timeout=10)
        print(f"Status: {response.status_code}")
        data = response.json()
        print(f"Response for purchased tender: {json.dumps(data, indent=2)}")
        access_to_purchased = data.get('access')
        
        # Check access to different tender (should be false)
        other_tender_id = "different_tender_id_123"
        response = requests.get(f"{BASE_URL}/access?email={test_email_single}&tenderId={other_tender_id}", timeout=10)
        data = response.json()
        print(f"Response for other tender: {json.dumps(data, indent=2)}")
        access_to_other = data.get('access')
        
        if access_to_purchased and not access_to_other:
            print("✅ PASS: Access correctly granted only to purchased tender")
        else:
            print(f"❌ FAIL: Access control incorrect (purchased={access_to_purchased}, other={access_to_other})")
    except Exception as e:
        print(f"❌ FAIL: Exception - {str(e)}")
else:
    print("⚠️  SKIP: No tender ID available")
print()

# Test 7: PDF access control
print("TEST 7: GET /api/tenders/{id}/pdf - ACCESS CONTROL")
print("-" * 80)

# 7a: Free user (no payment)
print("7a: Free user → 402")
free_user_email = generate_random_email()
if patancheru_tender_id:
    try:
        response = requests.get(f"{BASE_URL}/tenders/{patancheru_tender_id}/pdf?email={free_user_email}", timeout=10)
        print(f"Status: {response.status_code}")
        data = response.json()
        print(f"Response: {json.dumps(data, indent=2)}")
        if response.status_code == 402:
            print("✅ PASS: Free user correctly denied access (402)")
        else:
            print("❌ FAIL: Free user should get 402")
    except Exception as e:
        print(f"❌ FAIL: Exception - {str(e)}")
else:
    print("⚠️  SKIP: No tender ID available")
print()

# 7b: Premium user
print("7b: Premium user → 200 with watermarked=true")
if patancheru_tender_id and month_order_id:
    try:
        response = requests.get(f"{BASE_URL}/tenders/{patancheru_tender_id}/pdf?email={test_email_month}", timeout=10)
        print(f"Status: {response.status_code}")
        data = response.json()
        watermarked = data.get('watermarked')
        print(f"watermarked: {watermarked}")
        if response.status_code == 200 and watermarked:
            print("✅ PASS: Premium user granted access with watermark")
        else:
            print("❌ FAIL: Premium user should get 200 with watermarked=true")
    except Exception as e:
        print(f"❌ FAIL: Exception - {str(e)}")
else:
    print("⚠️  SKIP: No tender ID or premium user available")
print()

# 7c: Single-PDF user on their tender
print("7c: Single-PDF user on THEIR tender → 200")
if patancheru_tender_id and single_order_id:
    try:
        response = requests.get(f"{BASE_URL}/tenders/{patancheru_tender_id}/pdf?email={test_email_single}", timeout=10)
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            print("✅ PASS: Single-PDF user granted access to their tender")
        else:
            print("❌ FAIL: Single-PDF user should get 200 for their tender")
    except Exception as e:
        print(f"❌ FAIL: Exception - {str(e)}")
else:
    print("⚠️  SKIP: No tender ID or single user available")
print()

# 7d: Single-PDF user on different tender
print("7d: Single-PDF user on DIFFERENT tender → 402")
if single_order_id:
    different_tender_id = "different_tender_xyz"
    try:
        response = requests.get(f"{BASE_URL}/tenders/{different_tender_id}/pdf?email={test_email_single}", timeout=10)
        print(f"Status: {response.status_code}")
        if response.status_code == 402 or response.status_code == 404:
            print("✅ PASS: Single-PDF user denied access to different tender")
        else:
            print("❌ FAIL: Single-PDF user should get 402 for different tender")
    except Exception as e:
        print(f"❌ FAIL: Exception - {str(e)}")
else:
    print("⚠️  SKIP: No single user available")
print()

# Test 8: Webhook
print("TEST 8: POST /api/payment/webhook")
print("-" * 80)

# 8a: Valid webhook signature
print("8a: Valid webhook signature → {received: true}")
webhook_test_email = generate_random_email()
try:
    # Create order first
    response = requests.post(f"{BASE_URL}/payment/order", 
                            json={"email": webhook_test_email, "plan": "month"}, 
                            timeout=10)
    if response.status_code == 200:
        webhook_order_id = response.json().get('order', {}).get('id')
        print(f"Webhook test order ID: {webhook_order_id}")
        
        # Prepare webhook payload
        webhook_body = {
            "event": "payment.captured",
            "payload": {
                "payment": {
                    "entity": {
                        "order_id": webhook_order_id,
                        "id": "pay_WEBHOOK_TEST"
                    }
                }
            }
        }
        webhook_body_str = json.dumps(webhook_body)
        webhook_signature = compute_webhook_signature(webhook_body_str, RAZORPAY_WEBHOOK_SECRET)
        print(f"Webhook signature: {webhook_signature}")
        
        # Send webhook
        response = requests.post(f"{BASE_URL}/payment/webhook", 
                                json=webhook_body,
                                headers={"x-razorpay-signature": webhook_signature},
                                timeout=10)
        print(f"Status: {response.status_code}")
        data = response.json()
        print(f"Response: {json.dumps(data, indent=2)}")
        
        if response.status_code == 200 and data.get('received') == True:
            print("✅ PASS: Valid webhook accepted")
            
            # Verify user model updated
            time.sleep(1)  # Small delay for DB update
            response = requests.get(f"{BASE_URL}/me?email={webhook_test_email}", timeout=10)
            user_data = response.json()
            if user_data.get('is_premium'):
                print("✅ PASS: Webhook updated user model correctly")
            else:
                print("⚠️  WARNING: Webhook may not have updated user model")
        else:
            print("❌ FAIL: Valid webhook should be accepted")
    else:
        print("❌ FAIL: Failed to create webhook test order")
except Exception as e:
    print(f"❌ FAIL: Exception - {str(e)}")
print()

# 8b: Invalid webhook signature
print("8b: Invalid webhook signature → 400")
try:
    webhook_body = {
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "order_id": "order_test",
                    "id": "pay_test"
                }
            }
        }
    }
    wrong_signature = "wrong_webhook_signature_123"
    
    response = requests.post(f"{BASE_URL}/payment/webhook", 
                            json=webhook_body,
                            headers={"x-razorpay-signature": wrong_signature},
                            timeout=10)
    print(f"Status: {response.status_code}")
    data = response.json()
    print(f"Response: {json.dumps(data, indent=2)}")
    
    if response.status_code == 400:
        print("✅ PASS: Invalid webhook signature rejected")
    else:
        print("❌ FAIL: Invalid webhook signature should be rejected with 400")
except Exception as e:
    print(f"❌ FAIL: Exception - {str(e)}")
print()

print("=" * 80)
print("BACKEND TEST COMPLETE")
print("=" * 80)
