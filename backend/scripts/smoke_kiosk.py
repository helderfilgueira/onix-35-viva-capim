import argparse
import http.cookiejar
import json
import sys
import urllib.error
import urllib.request
import uuid
from http.cookies import SimpleCookie
from urllib.parse import urlsplit


def main():
    parser = argparse.ArgumentParser(description="Smoke test for the Viva Capim kiosk flow.")
    parser.add_argument("--base-url", required=True, help="API base URL, without trailing slash")
    parser.add_argument("--device-id", required=True)
    parser.add_argument("--gateway-token", required=True)
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    origin = "http://localhost:5173"
    parsed_base = urlsplit(base)
    local_http = parsed_base.scheme == "http" and parsed_base.hostname in {"127.0.0.1", "localhost", "::1"}
    cookies = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))
    local_session_cookie = None

    def request(method, path, payload=None, extra_headers=None):
        nonlocal local_session_cookie
        headers = {
            "Origin": origin,
            "X-Gateway-Token": args.gateway_token,
            "X-Verified-Device-Id": args.device_id,
        }
        if method != "GET":
            headers.update({"Content-Type": "application/json", "X-Kiosk-Request": "1"})
        if extra_headers:
            headers.update(extra_headers)
        # Secure cookies are intentionally not sent by cookie jars over HTTP.
        # For loopback-only development tests, replay the cookie received from
        # this same local API. Production/HTTPS requests use the normal cookie jar.
        if local_http and local_session_cookie:
            headers["Cookie"] = f"__Host-viva={local_session_cookie}"
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
        try:
            with opener.open(req, timeout=20) as response:
                body = response.read().decode()
                if local_http and path == "/v1/kiosk/sessions":
                    parsed_cookie = SimpleCookie()
                    parsed_cookie.load(response.headers.get("Set-Cookie", ""))
                    if "__Host-viva" in parsed_cookie:
                        local_session_cookie = parsed_cookie["__Host-viva"].value
                return response.status, json.loads(body) if body else None
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode()
            raise RuntimeError(f"{method} {path}: HTTP {exc.code}: {detail}") from exc

    status, catalog = request("GET", "/v1/kiosk/catalog")
    assert status == 200, "Kiosk catalog did not return HTTP 200"
    events = catalog.get("events", [])
    if not events:
        raise RuntimeError("No published future event found. Add a test event before running this smoke test.")
    event_id = events[0]["id"]

    status, config = request("GET", "/v1/kiosk/config")
    assert status == 200 and config["generation_id"] >= 0

    status, session = request("POST", "/v1/kiosk/sessions", {
        "notice_version": config["privacy_notice"]["version"],
        "purpose": "event_feedback",
        "accepted": True,
        "operation_id": str(uuid.uuid4()),
        "expected_generation": config["generation_id"],
    })
    assert status == 201
    csrf = session["csrf_token"]
    csrf_headers = {"X-CSRF-Token": csrf}

    status, activity = request("POST", "/v1/kiosk/session/activity",
        {"interaction": "touch"}, csrf_headers)
    assert status == 200

    participation_id = str(uuid.uuid4())
    status, participation = request("POST", "/v1/kiosk/participations", {
        "submission_id": participation_id,
        "event_id": event_id,
        "participation_type": "self_declared",
    }, {**csrf_headers, "Idempotency-Key": participation_id})
    assert status == 201 and participation["status"] == "committed"

    review_id = str(uuid.uuid4())
    status, review = request("POST", "/v1/kiosk/reviews", {
        "submission_id": review_id,
        "event_id": event_id,
        "score": 5,
        "aspect": "organization",
    }, {**csrf_headers, "Idempotency-Key": review_id})
    assert status == 201 and review["status"] == "committed"

    status, receipt = request("GET", f"/v1/kiosk/submissions/{review_id}", None, csrf_headers)
    assert status == 200 and receipt["status"] == "committed"

    status, _ = request("POST", "/v1/kiosk/session/end", None, csrf_headers)
    assert status == 204

    print("PASS: kiosk catalog")
    print("PASS: kiosk configuration")
    print("PASS: session creation and secure cookie")
    print("PASS: activity refresh")
    print("PASS: participation submission")
    print("PASS: review submission")
    print("PASS: submission receipt")
    print("PASS: session termination")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
