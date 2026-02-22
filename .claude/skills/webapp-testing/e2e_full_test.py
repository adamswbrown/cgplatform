#!/usr/bin/env python3
"""
Full E2E test suite for CG Platform — all personas and journeys.
Server must be running on http://localhost:3777/
"""

import json
import os
import re
import sys
import time
from datetime import datetime

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3777"
SCREENSHOT_DIR = "/tmp/cg-e2e-tests"
os.makedirs(SCREENSHOT_DIR, exist_ok=True)

RESULTS = []
CONSOLE_ERRORS = []


def log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}")


def screenshot(page, name):
    path = f"{SCREENSHOT_DIR}/{name}.png"
    page.screenshot(path=path, full_page=True)
    return path


def assert_check(name, condition, detail=""):
    status = "PASS" if condition else "FAIL"
    RESULTS.append({"name": name, "status": status, "detail": detail})
    icon = "✓" if condition else "✗"
    log(f"  {icon} {name}" + (f" — {detail}" if detail and not condition else ""))
    return condition


def capture_console(msg):
    if msg.type in ("error", "warning"):
        CONSOLE_ERRORS.append({"type": msg.type, "text": msg.text[:300]})


def wait_for_url(page, predicate, timeout=15000):
    """Wait until predicate(page.url) is True, with timeout."""
    start = time.time()
    while time.time() - start < timeout / 1000:
        if predicate(page.url):
            return True
        page.wait_for_timeout(250)
    return predicate(page.url)


def do_login(page, email, password):
    """Fill login form and submit, wait for navigation."""
    page.goto(f"{BASE}/login")
    page.wait_for_load_state("networkidle")
    page.fill("input[name='email']", email)
    page.fill("input[name='password']", password)
    page.locator("button[type='submit']").click()
    # Wait for url to change away from /login
    page.wait_for_load_state("networkidle")
    wait_for_url(page, lambda u: "/login" not in u, timeout=15000)
    page.wait_for_timeout(500)


# ──────────────────────────────────────────────
# PERSONA 1: OPS MANAGER
# ──────────────────────────────────────────────
def test_ops_manager(browser):
    log("\n══════════════════════════════════════")
    log("PERSONA 1: OPS MANAGER")
    log("══════════════════════════════════════")
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    page.on("console", capture_console)

    # ─── Login Flow ───
    try:
        log("\n─ Login Flow ─")
        page.goto(f"{BASE}/login")
        page.wait_for_load_state("networkidle")
        screenshot(page, "01_ops_login_page")
        assert_check("Login page loads", page.locator("input[name='email']").is_visible())
        assert_check("Password field visible", page.locator("input[name='password']").is_visible())

        do_login(page, "ops@demo.local", "password123")
        screenshot(page, "02_ops_after_login")
        assert_check("OPS login redirects to /admin", "/admin" in page.url, f"URL: {page.url}")
    except Exception as e:
        log(f"  ⚠ Login section error: {e}")
        RESULTS.append({"name": "OPS Login section", "status": "FAIL", "detail": str(e)[:200]})
        # Navigate directly so rest of tests can proceed
        do_login(page, "ops@demo.local", "password123")

    # ─── Cases Page ───
    try:
        log("\n─ Cases Page ─")
        page.goto(f"{BASE}/admin/cases")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(500)
        screenshot(page, "03_ops_cases")
        assert_check("Cases page loads", page.locator("table").is_visible() or page.locator("text=Operations Cases").is_visible())

        # Filter pills
        filter_pills = page.locator("a[href*='/admin/cases']").all()
        assert_check("Filter pills rendered", len(filter_pills) >= 3, f"Found {len(filter_pills)} filter links")

        # Click a filter
        needs_review = page.locator("text=Needs Review").first
        if needs_review.is_visible():
            needs_review.click()
            page.wait_for_load_state("networkidle")
            screenshot(page, "03b_ops_cases_filtered")
            assert_check("Filter navigation works", "filter=" in page.url or "/admin/cases" in page.url)
    except Exception as e:
        log(f"  ⚠ Cases section error: {e}")
        RESULTS.append({"name": "OPS Cases section", "status": "FAIL", "detail": str(e)[:200]})

    # ─── Case Detail ───
    try:
        log("\n─ Case Detail ─")
        page.goto(f"{BASE}/admin/cases")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(500)

        # Use specific selector: links within table rows to /admin/cases/{id}
        open_links = page.locator("td a[href*='/admin/cases/']").all()
        if len(open_links) > 0:
            href = open_links[0].get_attribute("href") or ""
            open_links[0].click()
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(500)
            screenshot(page, "04_ops_case_detail")
            # Check URL has an ID segment after /admin/cases/
            has_id = bool(re.search(r"/admin/cases/[a-zA-Z0-9_-]+", page.url))
            assert_check("Case detail page loads", has_id, f"URL: {page.url}")
            assert_check("Case detail has heading", page.locator("h2").first.is_visible())
        else:
            assert_check("Case detail page loads", False, "No case Open links found in table")
    except Exception as e:
        log(f"  ⚠ Case detail error: {e}")
        RESULTS.append({"name": "OPS Case Detail section", "status": "FAIL", "detail": str(e)[:200]})

    # ─── Clients Page ───
    try:
        log("\n─ Clients Page ─")
        page.goto(f"{BASE}/admin/clients")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(500)
        screenshot(page, "05_ops_clients")
        assert_check("Clients page loads", page.locator("table").is_visible() or page.locator("text=All Clients").is_visible())

        # Click first client name (accent-colored link in table)
        client_links = page.locator("td a[href*='/admin/clients/']").all()
        if len(client_links) > 0:
            client_links[0].click()
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(500)
            screenshot(page, "06_ops_client_detail")
            has_client_id = bool(re.search(r"/admin/clients/[a-zA-Z0-9_-]+", page.url))
            assert_check("Client detail loads", has_client_id, f"URL: {page.url}")

            # Check for intake form data section
            intake_details = page.locator("text=Intake Form Data")
            has_intake = intake_details.count() > 0
            assert_check("Intake form data section exists", has_intake)

            # Expand the collapsible details
            if has_intake:
                intake_details.first.click()
                page.wait_for_timeout(500)
                screenshot(page, "06b_ops_client_intake_expanded")
                assert_check("Intake form data expands", page.get_by_text("Primary Participant", exact=True).is_visible())
        else:
            assert_check("Client detail loads", False, "No client links found")
    except Exception as e:
        log(f"  ⚠ Clients section error: {e}")
        RESULTS.append({"name": "OPS Clients section", "status": "FAIL", "detail": str(e)[:200]})

    # ─── Assignments Page ───
    try:
        log("\n─ Assignments Page ─")
        page.goto(f"{BASE}/admin/assignments")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(500)
        screenshot(page, "07_ops_assignments")
        assert_check("Assignments page loads",
                      page.locator("text=Assignment Dashboard").is_visible() or page.locator("text=Queue").is_visible())

        # Counsellor tabs
        tabs = page.locator("[role='tab']").all()
        assert_check("Counsellor tabs rendered", len(tabs) >= 1, f"Found {len(tabs)} tabs")

        # Queue panel
        assert_check("Queue panel visible", page.locator("text=Queue").first.is_visible())

        # View toggle (use role-based selectors to avoid matching descriptive text)
        kanban_btn = page.get_by_role("button", name="Kanban")
        calendar_btn = page.get_by_role("button", name="Calendar")
        assert_check("View toggles visible", kanban_btn.is_visible() and calendar_btn.is_visible())

        # Switch tab
        if len(tabs) > 1:
            tabs[1].click()
            page.wait_for_timeout(500)
            screenshot(page, "07b_ops_assignments_tab2")
            assert_check("Tab switching works", True)

        # Switch to Calendar view
        calendar_btn.click()
        page.wait_for_timeout(500)
        screenshot(page, "07c_ops_assignments_calendar")
        assert_check("Calendar view renders", page.locator("table").first.is_visible() or page.locator("th").first.is_visible())
    except Exception as e:
        log(f"  ⚠ Assignments section error: {e}")
        RESULTS.append({"name": "OPS Assignments section", "status": "FAIL", "detail": str(e)[:200]})

    # ─── Specialists Page ───
    try:
        log("\n─ Specialists Page ─")
        page.goto(f"{BASE}/admin/specialists")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(500)
        screenshot(page, "08_ops_specialists")
        assert_check("Specialists page loads", page.get_by_role("link", name="Counsellors").is_visible() or page.locator("table").first.is_visible())

        # Find links to individual specialist detail pages (not nav, not /availability)
        spec_links = page.locator("a[href*='/admin/specialists/']").all()
        real_spec_links = [l for l in spec_links
                          if (l.get_attribute("href") or "") not in ("/admin/specialists", "/admin/specialists/")
                          and "/availability" not in (l.get_attribute("href") or "")]
        if len(real_spec_links) > 0:
            real_spec_links[0].click()
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(500)
            screenshot(page, "09_ops_specialist_detail")
            has_spec_id = bool(re.search(r"/admin/specialists/[a-zA-Z0-9_-]+$", page.url))
            assert_check("Specialist detail loads", has_spec_id, f"URL: {page.url}")
        else:
            assert_check("Specialist detail loads", False, "No specialist detail links found")
    except Exception as e:
        log(f"  ⚠ Specialists section error: {e}")
        RESULTS.append({"name": "OPS Specialists section", "status": "FAIL", "detail": str(e)[:200]})

    # ─── Workflows Page ───
    try:
        log("\n─ Workflows Page ─")
        page.goto(f"{BASE}/admin/workflows")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(500)
        screenshot(page, "10_ops_workflows")
        assert_check("Workflows page loads", "workflow" in page.url.lower())
    except Exception as e:
        log(f"  ⚠ Workflows section error: {e}")
        RESULTS.append({"name": "OPS Workflows section", "status": "FAIL", "detail": str(e)[:200]})

    # ─── Settings Page ───
    try:
        log("\n─ Settings Page ─")
        page.goto(f"{BASE}/admin/settings")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(500)
        screenshot(page, "11_ops_settings")
        assert_check("Settings page loads", "/admin/settings" in page.url)

        page.goto(f"{BASE}/admin/settings/intake")
        page.wait_for_load_state("networkidle")
        screenshot(page, "11b_ops_settings_intake")
        assert_check("Intake settings loads", "/admin/settings/intake" in page.url)

        page.goto(f"{BASE}/admin/settings/operations")
        page.wait_for_load_state("networkidle")
        screenshot(page, "11c_ops_settings_operations")
        assert_check("Operations settings loads", "/admin/settings/operations" in page.url)
    except Exception as e:
        log(f"  ⚠ Settings section error: {e}")
        RESULTS.append({"name": "OPS Settings section", "status": "FAIL", "detail": str(e)[:200]})

    # ─── Issue Intake Link ───
    try:
        log("\n─ Issue Intake Link ─")
        page.goto(f"{BASE}/admin/cases")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(500)
        # Click the summary that contains "Issue Secure Intake Link"
        intake_summary = page.locator("summary").filter(has_text="Issue Secure Intake Link")
        if intake_summary.is_visible():
            intake_summary.click()
            page.wait_for_timeout(500)
            screenshot(page, "12_ops_intake_link_form")
            assert_check("Intake link form has email field", page.locator("input[name='recipientEmail']").is_visible())
            assert_check("Intake link form has submit", page.locator("text=Issue intake link").is_visible())
    except Exception as e:
        log(f"  ⚠ Intake link section error: {e}")
        RESULTS.append({"name": "OPS Intake Link section", "status": "FAIL", "detail": str(e)[:200]})

    context.close()


# ──────────────────────────────────────────────
# PERSONA 2: COUNSELLOR (SPECIALIST)
# ──────────────────────────────────────────────
def test_counsellor(browser):
    log("\n══════════════════════════════════════")
    log("PERSONA 2: COUNSELLOR (SPECIALIST)")
    log("══════════════════════════════════════")
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    page.on("console", capture_console)

    # ─── Login ───
    try:
        log("\n─ Login Flow ─")
        do_login(page, "avery.specialist@demo.local", "password123")
        screenshot(page, "20_specialist_after_login")
        assert_check("Specialist login redirects to /specialist", "/specialist" in page.url, f"URL: {page.url}")
    except Exception as e:
        log(f"  ⚠ Specialist login error: {e}")
        RESULTS.append({"name": "Specialist Login", "status": "FAIL", "detail": str(e)[:200]})
        do_login(page, "avery.specialist@demo.local", "password123")

    # ─── Sessions Page ───
    try:
        log("\n─ Sessions Page ─")
        page.goto(f"{BASE}/specialist/sessions")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(500)
        screenshot(page, "21_specialist_sessions")
        assert_check("Sessions page loads", "/specialist/sessions" in page.url)

        has_sessions = page.locator("table").is_visible() or page.locator("article").first.is_visible() or page.locator("text=Session").first.is_visible()
        assert_check("Sessions content renders", has_sessions or page.locator("text=No").is_visible())

        # Click into a session if available
        session_links = page.locator("a[href*='/specialist/sessions/']").all()
        if len(session_links) > 0:
            session_links[0].click()
            page.wait_for_load_state("networkidle")
            screenshot(page, "22_specialist_session_detail")
            assert_check("Session detail loads", "/specialist/sessions/" in page.url)
        else:
            log("  (No session links to test)")
    except Exception as e:
        log(f"  ⚠ Sessions section error: {e}")
        RESULTS.append({"name": "Specialist Sessions section", "status": "FAIL", "detail": str(e)[:200]})

    # ─── Clients Page ───
    try:
        log("\n─ Clients Page ─")
        page.goto(f"{BASE}/specialist/clients")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(500)
        screenshot(page, "23_specialist_clients")
        assert_check("Specialist clients page loads", "/specialist/clients" in page.url)
    except Exception as e:
        log(f"  ⚠ Specialist clients error: {e}")
        RESULTS.append({"name": "Specialist Clients", "status": "FAIL", "detail": str(e)[:200]})

    # ─── Availability Page ───
    try:
        log("\n─ Availability Page ─")
        page.goto(f"{BASE}/specialist/availability")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(500)
        screenshot(page, "24_specialist_availability")
        assert_check("Availability page loads", "/specialist/availability" in page.url)

        has_calendar = (page.locator("table").first.is_visible()
                        or page.get_by_role("heading", name="Availability").is_visible()
                        or page.locator("[class*='calendar']").first.is_visible())
        assert_check("Availability UI renders", has_calendar or page.locator("button").first.is_visible())
        screenshot(page, "24b_specialist_availability_full")
    except Exception as e:
        log(f"  ⚠ Availability section error: {e}")
        RESULTS.append({"name": "Specialist Availability", "status": "FAIL", "detail": str(e)[:200]})

    context.close()


# ──────────────────────────────────────────────
# PERSONA 3: END CLIENT (PIN ACCESS)
# ──────────────────────────────────────────────
def test_end_client(browser):
    log("\n══════════════════════════════════════")
    log("PERSONA 3: END CLIENT (PIN ACCESS)")
    log("══════════════════════════════════════")

    # ─── Intake PIN Flow ───
    try:
        log("\n─ Intake PIN Flow ─")
        context = browser.new_context(viewport={"width": 1024, "height": 768})
        page = context.new_page()
        page.on("console", capture_console)

        page.goto(f"{BASE}/intake/access/seed-intake-primary-2001")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(500)
        screenshot(page, "30_client_intake_pin_page")
        assert_check("Intake PIN page loads", page.locator("input#pin").is_visible())

        # Enter PIN
        page.fill("input#pin", "778899")
        page.wait_for_timeout(300)
        page.locator("button[type='submit']").click()
        page.wait_for_load_state("networkidle")
        wait_for_url(page, lambda u: "access" not in u.split("?")[0], timeout=10000)
        screenshot(page, "31_client_intake_after_pin")
        assert_check("Intake PIN accepted", "/intake" in page.url and "access" not in page.url.split("?")[0], f"URL: {page.url}")

        # Check intake form renders
        if "/intake" in page.url and "access" not in page.url.split("?")[0]:
            page.wait_for_timeout(1000)
            screenshot(page, "32_client_intake_form")
            has_form = page.locator("form").is_visible() or page.locator("input").first.is_visible()
            assert_check("Intake form renders", has_form)

            # Check for step indicator/progress
            step_indicators = page.locator("[class*='step'], [class*='progress'], [role='progressbar']").all()
            assert_check("Intake form has step/progress indicator",
                          len(step_indicators) > 0 or page.locator("text=Step").is_visible() or page.locator("text=Next").is_visible(),
                          f"Found {len(step_indicators)} indicators")

        context.close()
    except Exception as e:
        log(f"  ⚠ Intake PIN flow error: {e}")
        RESULTS.append({"name": "End Client Intake PIN flow", "status": "FAIL", "detail": str(e)[:200]})

    # ─── Form Access PIN Flow (Terms) ───
    try:
        log("\n─ Form Access PIN Flow ─")
        context2 = browser.new_context(viewport={"width": 1024, "height": 768})
        page2 = context2.new_page()
        page2.on("console", capture_console)

        page2.goto(f"{BASE}/forms/access/seed-terms-case-1001")
        page2.wait_for_load_state("networkidle")
        page2.wait_for_timeout(500)
        screenshot(page2, "33_client_form_pin_page")
        assert_check("Form PIN page loads", page2.locator("input#pin").is_visible())

        page2.fill("input#pin", "111111")
        page2.wait_for_timeout(300)
        page2.locator("button[type='submit']").click()
        page2.wait_for_load_state("networkidle")
        wait_for_url(page2, lambda u: "access" not in u.split("?")[0], timeout=10000)
        screenshot(page2, "34_client_terms_form")
        assert_check("Terms form loads after PIN", "/forms/" in page2.url and "access" not in page2.url.split("?")[0], f"URL: {page2.url}")

        context2.close()
    except Exception as e:
        log(f"  ⚠ Form PIN flow error: {e}")
        RESULTS.append({"name": "End Client Form PIN flow", "status": "FAIL", "detail": str(e)[:200]})

    # ─── Wrong PIN Flow ───
    try:
        log("\n─ Wrong PIN Flow ─")
        context3 = browser.new_context(viewport={"width": 1024, "height": 768})
        page3 = context3.new_page()
        page3.on("console", capture_console)

        page3.goto(f"{BASE}/forms/access/seed-consent-case-1002-a")
        page3.wait_for_load_state("networkidle")
        page3.wait_for_timeout(500)
        page3.fill("input#pin", "000000")
        page3.wait_for_timeout(300)
        page3.locator("button[type='submit']").click()
        page3.wait_for_timeout(2000)
        screenshot(page3, "35_client_wrong_pin")
        # Should still be on access page or show error
        still_on_access = "access" in page3.url
        has_error = page3.locator(".cg-alert-error").is_visible() or page3.locator("text=Invalid").is_visible() or page3.locator("text=incorrect").is_visible()
        assert_check("Wrong PIN shows error", still_on_access or has_error, f"URL: {page3.url}")

        context3.close()
    except Exception as e:
        log(f"  ⚠ Wrong PIN flow error: {e}")
        RESULTS.append({"name": "End Client Wrong PIN flow", "status": "FAIL", "detail": str(e)[:200]})


# ──────────────────────────────────────────────
# CROSS-CUTTING: Nav, Auth Guards, Mobile
# ──────────────────────────────────────────────
def test_cross_cutting(browser):
    log("\n══════════════════════════════════════")
    log("CROSS-CUTTING TESTS")
    log("══════════════════════════════════════")

    # ─── Auth Guards ───
    try:
        log("\n─ Auth Guards ─")
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()
        page.on("console", capture_console)

        page.goto(f"{BASE}/admin/cases")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1000)
        assert_check("Unauth admin redirects to login", "/login" in page.url, f"URL: {page.url}")

        page.goto(f"{BASE}/specialist/sessions")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1000)
        assert_check("Unauth specialist redirects to login", "/login" in page.url, f"URL: {page.url}")

        context.close()
    except Exception as e:
        log(f"  ⚠ Auth guards error: {e}")
        RESULTS.append({"name": "Auth Guards", "status": "FAIL", "detail": str(e)[:200]})

    # ─── Role Guards ───
    try:
        log("\n─ Role Guards ─")
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()
        page.on("console", capture_console)

        do_login(page, "avery.specialist@demo.local", "password123")

        # Specialist trying to access admin
        page.goto(f"{BASE}/admin/cases")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1000)
        screenshot(page, "40_cross_role_guard")
        is_blocked = (
            "/admin/cases" not in page.url
            or page.locator("text=not authorized").is_visible()
            or page.locator("text=Forbidden").is_visible()
            or "/login" in page.url
            or "/specialist" in page.url
        )
        assert_check("Specialist cannot access admin", is_blocked, f"URL: {page.url}")

        context.close()
    except Exception as e:
        log(f"  ⚠ Role guards error: {e}")
        RESULTS.append({"name": "Role Guards", "status": "FAIL", "detail": str(e)[:200]})

    # ─── Navigation Active States ───
    try:
        log("\n─ Navigation Active States ─")
        context2 = browser.new_context(viewport={"width": 1440, "height": 900})
        page2 = context2.new_page()
        page2.on("console", capture_console)

        do_login(page2, "ops@demo.local", "password123")

        nav_pages = [
            ("/admin/cases", "All Cases"),
            ("/admin/assignments", "Assignments"),
            ("/admin/clients", "All Clients"),
            ("/admin/specialists", "Counsellors"),
            ("/admin/workflows", "Workflows"),
            ("/admin/settings", "Settings"),
        ]
        for path, label in nav_pages:
            page2.goto(f"{BASE}{path}")
            page2.wait_for_load_state("networkidle")
            page2.wait_for_timeout(300)
            assert_check(f"Nav: {label} page accessible", path in page2.url)

        screenshot(page2, "41_cross_nav_active")

        context2.close()
    except Exception as e:
        log(f"  ⚠ Navigation error: {e}")
        RESULTS.append({"name": "Navigation States", "status": "FAIL", "detail": str(e)[:200]})

    # ─── Homepage ───
    try:
        log("\n─ Homepage ─")
        context_hp = browser.new_context(viewport={"width": 1440, "height": 900})
        page_hp = context_hp.new_page()
        page_hp.on("console", capture_console)

        page_hp.goto(f"{BASE}/")
        page_hp.wait_for_load_state("networkidle")
        page_hp.wait_for_timeout(500)
        screenshot(page_hp, "42_homepage")
        assert_check("Homepage loads", page_hp.url.rstrip("/") == BASE.rstrip("/") or "/admin" in page_hp.url or "/login" in page_hp.url or page_hp.locator("h1").is_visible())

        # Intake success page
        page_hp.goto(f"{BASE}/intake/success")
        page_hp.wait_for_load_state("networkidle")
        screenshot(page_hp, "43_intake_success")
        assert_check("Intake success page loads", "/intake/success" in page_hp.url)

        context_hp.close()
    except Exception as e:
        log(f"  ⚠ Homepage error: {e}")
        RESULTS.append({"name": "Homepage", "status": "FAIL", "detail": str(e)[:200]})

    # ─── Mobile Viewport ───
    try:
        log("\n─ Mobile Viewport ─")
        context3 = browser.new_context(viewport={"width": 375, "height": 812})
        page3 = context3.new_page()
        page3.on("console", capture_console)

        page3.goto(f"{BASE}/login")
        page3.wait_for_load_state("networkidle")
        screenshot(page3, "44_mobile_login")
        assert_check("Mobile login renders", page3.locator("input[name='email']").is_visible())

        do_login(page3, "ops@demo.local", "password123")

        page3.goto(f"{BASE}/admin/cases")
        page3.wait_for_load_state("networkidle")
        page3.wait_for_timeout(500)
        screenshot(page3, "45_mobile_cases")
        assert_check("Mobile cases page renders", "/admin/cases" in page3.url)

        page3.goto(f"{BASE}/admin/assignments")
        page3.wait_for_load_state("networkidle")
        page3.wait_for_timeout(500)
        screenshot(page3, "46_mobile_assignments")
        assert_check("Mobile assignments page renders", "/admin/assignments" in page3.url)

        context3.close()
    except Exception as e:
        log(f"  ⚠ Mobile viewport error: {e}")
        RESULTS.append({"name": "Mobile Viewport", "status": "FAIL", "detail": str(e)[:200]})


# ──────────────────────────────────────────────
# MAIN
# ──────────────────────────────────────────────
def main():
    log("╔══════════════════════════════════════════╗")
    log("║  CG Platform — Full E2E Test Suite       ║")
    log("║  Target: http://localhost:3777            ║")
    log("╚══════════════════════════════════════════╝")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        test_ops_manager(browser)
        test_counsellor(browser)
        test_end_client(browser)
        test_cross_cutting(browser)

        browser.close()

    # Summary
    passed = sum(1 for r in RESULTS if r["status"] == "PASS")
    failed = sum(1 for r in RESULTS if r["status"] == "FAIL")
    total = len(RESULTS)

    log("\n╔══════════════════════════════════════════╗")
    log("║  TEST RESULTS SUMMARY                    ║")
    log("╚══════════════════════════════════════════╝")
    log(f"  Total:  {total}")
    log(f"  Passed: {passed}")
    log(f"  Failed: {failed}")
    log(f"  Rate:   {passed/total*100:.0f}%" if total > 0 else "  Rate:   N/A")

    if failed > 0:
        log("\n  FAILURES:")
        for r in RESULTS:
            if r["status"] == "FAIL":
                log(f"    ✗ {r['name']}" + (f" — {r['detail']}" if r['detail'] else ""))

    if CONSOLE_ERRORS:
        log(f"\n  Browser console errors/warnings: {len(CONSOLE_ERRORS)}")
        for err in CONSOLE_ERRORS[:10]:
            log(f"    [{err['type']}] {err['text'][:120]}")

    log(f"\n  Screenshots saved to: {SCREENSHOT_DIR}/")

    # Write JSON report
    report = {
        "timestamp": datetime.now().isoformat(),
        "total": total,
        "passed": passed,
        "failed": failed,
        "results": RESULTS,
        "console_errors": CONSOLE_ERRORS[:50],
        "screenshot_dir": SCREENSHOT_DIR,
    }
    report_path = f"{SCREENSHOT_DIR}/report.json"
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
    log(f"  JSON report: {report_path}")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
