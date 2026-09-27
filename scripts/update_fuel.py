#!/usr/bin/env python3
"""Refresh data/fuel.json with national/regional retail petrol and diesel prices.

Official weekly feeds (no API keys, standard library only):
  - US:  EIA weekly retail gasoline & diesel (national + regions)
  - EU:  European Commission Weekly Oil Bulletin (27 member states + EU average)
  - UK:  DESNZ weekly road fuel prices
  - FX:  ECB euro reference rates, to express everything in US$/litre

Entries with "feed": "agent" (countries without an open feed, added by the
update agent from cited sources) are preserved untouched.

Usage:  python3 scripts/update_fuel.py
"""
import csv
import datetime as dt
import io
import json
import os
import re
import ssl
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "fuel.json"
PRE_CRISIS = "2026-02-23"          # reference week before the Hormuz disruption
HISTORY_FROM = "2025-09-01"        # keep ~1 year of weekly history for sparklines
UA = {"User-Agent": "Mozilla/5.0 (energy-infrastructure-map fuel updater)"}
GAL = 3.785411784

EIA_SERIES = [  # id, name, coords, gasoline series, diesel series
    ("us", "United States", [39.5, -98.35], "EMM_EPMR_PTE_NUS_DPG", "EMD_EPD2D_PTE_NUS_DPG"),
    ("us-east", "US East Coast", [38.5, -77.5], "EMM_EPMR_PTE_R10_DPG", "EMD_EPD2D_PTE_R10_DPG"),
    ("us-midwest", "US Midwest", [41.5, -89.0], "EMM_EPMR_PTE_R20_DPG", "EMD_EPD2D_PTE_R20_DPG"),
    ("us-gulf", "US Gulf Coast", [31.0, -95.0], "EMM_EPMR_PTE_R30_DPG", "EMD_EPD2D_PTE_R30_DPG"),
    ("us-rockies", "US Rocky Mountain", [42.0, -108.0], "EMM_EPMR_PTE_R40_DPG", "EMD_EPD2D_PTE_R40_DPG"),
    ("us-west", "US West Coast", [44.0, -121.0], "EMM_EPMR_PTE_R50_DPG", "EMD_EPD2D_PTE_R50_DPG"),
    ("us-california", "California", [36.8, -119.4], "EMM_EPMR_PTE_SCA_DPG", "EMD_EPD2D_PTE_SCA_DPG"),
]

EU = {  # Oil Bulletin country code -> (id, name, coords)
    "EU": ("eu", "EU average", [50.5, 9.5]),
    "AT": ("at", "Austria", [47.6, 14.1]), "BE": ("be", "Belgium", [50.6, 4.6]), "BG": ("bg", "Bulgaria", [42.7, 25.3]),
    "HR": ("hr", "Croatia", [45.3, 16.0]), "CY": ("cy", "Cyprus", [35.1, 33.4]), "CZ": ("cz", "Czechia", [49.8, 15.5]),
    "DK": ("dk", "Denmark", [56.0, 9.3]), "EE": ("ee", "Estonia", [58.7, 25.5]), "FI": ("fi", "Finland", [62.5, 26.0]),
    "FR": ("fr", "France", [46.6, 2.4]), "DE": ("de", "Germany", [51.1, 10.4]), "GR": ("gr", "Greece", [39.1, 22.0]),
    "EL": ("gr", "Greece", [39.1, 22.0]),
    "HU": ("hu", "Hungary", [47.2, 19.4]), "IE": ("ie", "Ireland", [53.2, -8.0]), "IT": ("it", "Italy", [42.8, 12.6]),
    "LV": ("lv", "Latvia", [56.9, 24.9]), "LT": ("lt", "Lithuania", [55.3, 23.9]), "LU": ("lu", "Luxembourg", [49.8, 6.1]),
    "MT": ("mt", "Malta", [35.9, 14.4]), "NL": ("nl", "Netherlands", [52.2, 5.5]), "PL": ("pl", "Poland", [52.0, 19.4]),
    "PT": ("pt", "Portugal", [39.6, -8.0]), "RO": ("ro", "Romania", [45.9, 24.9]), "SK": ("sk", "Slovakia", [48.7, 19.7]),
    "SI": ("si", "Slovenia", [46.1, 14.8]), "ES": ("es", "Spain", [40.3, -3.7]), "SE": ("se", "Sweden", [62.0, 15.0]),
}


def _ssl_context():
    # python.org builds on macOS ship without CA certs; fall back to certifi or the system bundle
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        pass
    ctx = ssl.create_default_context()
    if os.path.exists("/etc/ssl/cert.pem"):
        ctx.load_verify_locations(cafile="/etc/ssl/cert.pem")
    return ctx


SSL = _ssl_context()


def get(url, timeout=120):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout, context=SSL) as r:
        return r.read()


def series_block(points):
    """points: sorted list of (iso_date, value) -> {now, week_ago, pre_crisis, date, history}"""
    points = [p for p in points if p[1] is not None]
    if not points:
        return None
    pre = [v for d, v in points if d <= PRE_CRISIS]
    return {
        "now": round(points[-1][1], 3),
        "week_ago": round(points[-2][1], 3) if len(points) > 1 else None,
        "pre_crisis": round(pre[-1], 3) if pre else None,
        "date": points[-1][0],
        "history": [[d, round(v, 3)] for d, v in points if d >= HISTORY_FROM],
    }


# ── FX (ECB) ──
def fx():
    x = ET.fromstring(get("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", 60))
    ns = {"e": "http://www.ecb.int/vocabulary/2002-08-01/eurofxref"}
    day = x.find(".//e:Cube[@time]", ns)
    rates = {c.get("currency"): float(c.get("rate")) for c in day.findall("e:Cube", ns)}
    return {"date": day.get("time"), "usd_per_eur": rates["USD"], "usd_per_gbp": rates["USD"] / rates["GBP"],
            "source": {"name": "ECB euro reference rates", "url": "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html", "date": day.get("time")}}


# ── US (EIA) ──
def eia_series(sid):
    html = get(f"https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s={sid}&f=W", 60).decode("utf-8", "replace")
    pts = []
    for row in re.findall(r"<tr>\s*<td class=.B6.>(.*?)</tr>", html, re.S):
        txt = re.sub(r"<[^>]+>|&nbsp;", " ", row)
        m = re.match(r"\s*(\d{4})-\w+", txt)
        if not m:
            continue
        year = int(m.group(1))
        for md, val in re.findall(r"(\d{2}/\d{2})\s+([\d.]+)", txt):
            mo, da = map(int, md.split("/"))
            pts.append((dt.date(year, mo, da).isoformat(), float(val)))
    return sorted(pts)


def us_entries(usd_l):
    out = []
    for id_, name, coords, gas, dsl in EIA_SERIES:
        p, d = series_block(eia_series(gas)), series_block(eia_series(dsl))
        if not p:
            continue
        out.append({
            "id": id_, "name": name, "group": "country" if id_ == "us" else "us-region", "coords": coords,
            "currency": "USD", "unit": "$/gal", "date": p["date"], "petrol": p, "diesel": d,
            "usd_per_litre": {"petrol": usd_l(p["now"]), "diesel": usd_l(d["now"]) if d else None},
            "source": {"name": "US EIA weekly retail gasoline and diesel prices", "url": "https://www.eia.gov/petroleum/gasdiesel/", "date": p["date"]},
            "feed": "eia",
        })
    return out


# ── EU (Weekly Oil Bulletin) ──
def eu_entries(usd_per_eur):
    page = get("https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en", 60).decode("utf-8", "replace")
    href = re.search(r'href="([^"]+Prices_History[^"]*\.xlsx[^"]*)"', page)
    if not href:
        raise RuntimeError("Oil Bulletin history link not found")
    url = href.group(1).replace("&amp;", "&")
    url = url if url.startswith("http") else "https://energy.ec.europa.eu" + url
    z = zipfile.ZipFile(io.BytesIO(get(url, 300)))
    M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    ss = [''.join(t.text or '' for t in si.iter(M + "t")) for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(M + "si")]
    # find the "Prices with taxes" sheet file
    wb = z.read("xl/workbook.xml").decode()
    rels = z.read("xl/_rels/workbook.xml.rels").decode()
    rid = re.search(r'<sheet [^>]*name="Prices with taxes"[^>]*r:id="(rId\d+)"', wb).group(1)
    target = re.search(rf'Id="{rid}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="{rid}"', rels)
    sheet = "xl/" + (target.group(1) or target.group(2)).lstrip("/").replace("xl/", "")
    cols, series = {}, {}
    for _, el in ET.iterparse(z.open(sheet)):
        if el.tag != M + "row":
            continue
        cells = {}
        for c in el.findall(M + "c"):
            v = c.find(M + "v")
            if v is not None:
                cells[re.match(r"[A-Z]+", c.get("r")).group(0)] = ss[int(v.text)] if c.get("t") == "s" else v.text
        if not cols:  # header row: CODE_price_with_tax_euro95 / _diesel
            for col, h in cells.items():
                m = re.match(r"([A-Z]{2})_price_with_tax_(euro95|diesel)$", h or "")
                if m and m.group(1) in EU:
                    cols[col] = (m.group(1), "petrol" if m.group(2) == "euro95" else "diesel")
        elif re.fullmatch(r"\d{5}(\.0)?", cells.get("A", "") or ""):
            date = (dt.date(1899, 12, 30) + dt.timedelta(days=int(float(cells["A"])))).isoformat()
            for col, key in cols.items():
                try:
                    series.setdefault(key, []).append((date, float(cells[col]) / 1000))  # €/1000 l → €/l
                except (KeyError, ValueError):
                    pass
        el.clear()
    out = []
    for code, (id_, name, coords) in EU.items():
        p, d = series_block(sorted(series.get((code, "petrol"), []))), series_block(sorted(series.get((code, "diesel"), [])))
        if not p or id_ in {e["id"] for e in out}:
            continue
        out.append({
            "id": id_, "name": name, "group": "eu-average" if code == "EU" else "country", "coords": coords,
            "currency": "EUR", "unit": "€/l", "date": p["date"], "petrol": p, "diesel": d,
            "usd_per_litre": {"petrol": round(p["now"] * usd_per_eur, 3), "diesel": round(d["now"] * usd_per_eur, 3) if d else None},
            "source": {"name": "European Commission Weekly Oil Bulletin (prices with taxes)", "url": "https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en", "date": p["date"]},
            "feed": "eu-oil-bulletin",
        })
    return out


# ── UK (DESNZ) ──
def uk_entry(usd_per_gbp):
    page = get("https://www.gov.uk/government/statistics/weekly-road-fuel-prices", 60).decode("utf-8", "replace")
    href = re.search(r'href="(https://assets\.publishing\.service\.gov\.uk/[^"]+\.csv)"', page).group(1)
    text = get(href, 60).decode("utf-8-sig", "replace")
    pts_p, pts_d = [], []
    for row in csv.reader(io.StringIO(text)):
        try:
            d = dt.datetime.strptime(row[0].strip(), "%d/%m/%Y").date().isoformat()
            pts_p.append((d, float(row[1]) / 100)); pts_d.append((d, float(row[2]) / 100))  # pence → £
        except (ValueError, IndexError):
            continue
    p, d = series_block(sorted(pts_p)), series_block(sorted(pts_d))
    return {
        "id": "uk", "name": "United Kingdom", "group": "country", "coords": [54.0, -2.5],
        "currency": "GBP", "unit": "£/l", "date": p["date"], "petrol": p, "diesel": d,
        "usd_per_litre": {"petrol": round(p["now"] * usd_per_gbp, 3), "diesel": round(d["now"] * usd_per_gbp, 3)},
        "source": {"name": "UK DESNZ weekly road fuel prices", "url": "https://www.gov.uk/government/statistics/weekly-road-fuel-prices", "date": p["date"]},
        "feed": "uk-desnz",
    }


def main():
    prev = json.loads(OUT.read_text()) if OUT.exists() else {}
    prev_entries = {e["id"]: e for e in prev.get("entries", [])}
    f = fx()
    entries, errors = [], []
    for label, fn in [("EIA", lambda: us_entries(lambda v: round(v / GAL, 3))),
                      ("EU Oil Bulletin", lambda: eu_entries(f["usd_per_eur"])),
                      ("UK DESNZ", lambda: [uk_entry(f["usd_per_gbp"])])]:
        try:
            entries += fn()
        except Exception as e:  # keep last good data for a feed that fails
            errors.append(f"{label}: {e}")
            feed = {"EIA": "eia", "EU Oil Bulletin": "eu-oil-bulletin", "UK DESNZ": "uk-desnz"}[label]
            entries += [e for e in prev_entries.values() if e.get("feed") == feed]
    ids = {e["id"] for e in entries}
    entries += [e for e in prev_entries.values() if e.get("feed") == "agent" and e["id"] not in ids]
    data = {
        "as_of": max(e["date"] for e in entries if e.get("feed") != "agent"),
        "pre_crisis_date": PRE_CRISIS,
        "fx": f,
        "note": "Retail pump prices including taxes. US$/litre conversions use ECB reference rates. Taxes differ widely between countries, so much of the gap between them comes from policy rather than crude costs.",
        "entries": entries,
    }
    OUT.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")
    print(f"Wrote {OUT.relative_to(ROOT)}: {len(entries)} entries, as of {data['as_of']}")
    for e in errors:
        print("WARNING —", e, file=sys.stderr)
    return 1 if len(errors) == 3 else 0


if __name__ == "__main__":
    sys.exit(main())
