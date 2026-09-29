#!/usr/bin/env bash
# End-to-end API verification against a running BHUMISETU server.
# Usage: bash scripts/verify-api.sh [base-url]
set -u
B="${1:-http://localhost:12001/api}"

tok=$(curl -s -X POST "$B/auth/login" -H 'content-type: application/json' \
  -d '{"username":"citizen","password":"citizen@123"}' | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))")
echo "citizen token acquired: ${tok:0:10}..."

echo "--- citizen parcel view (masked) ---"
curl -s "$B/parcels/PARC-B" -H "authorization: Bearer $tok" | python3 -c "
import sys,json;d=json.load(sys.stdin)
print('maskedForRole', d['maskedForRole'], '| rorHolder', d['ownership']['rorHolder'])"

echo "--- citizen passport ---"
curl -s "$B/passport/PARC-B" -H "authorization: Bearer $tok" | python3 -c "
import sys,json;d=json.load(sys.stdin)
print('parties', [(p['role'],p['name']) for p in d['ownership']['parties']][:4])
print('tax due', d['tax']['records'][0]['due'])
print('findings', [f['ruleCode'] for f in d['findings']])"

echo "--- citizen creates verification case ---"
case=$(curl -s -X POST "$B/cases" -H "authorization: Bearer $tok" -H 'content-type: application/json' \
  -d '{"parcelId":"PARC-B","title":"Ownership records require reconciliation","description":"RoR names K. Meenakshi; the deed transfers to R. Suresh.","priority":"HIGH","findingRefs":["FND-PARC-B-OWNERSHIP_MISMATCH"]}')
echo "$case" | python3 -c "import sys,json;d=json.load(sys.stdin);print('case', d.get('case_number'), d.get('status'), d.get('assigned_department'))"
cid=$(echo "$case" | python3 -c "import sys,json;print(json.load(sys.stdin).get('case_id',''))")

echo "--- officer login + status update ---"
otok=$(curl -s -X POST "$B/auth/login" -H 'content-type: application/json' \
  -d '{"username":"revenue","password":"officer@123"}' | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))")
curl -s -X POST "$B/cases/$cid/update" -H "authorization: Bearer $otok" -H 'content-type: application/json' \
  -d '{"status":"UNDER_REVIEW","reason":"Assigned for reconciliation review","comment":"Initial review: the deed and RoR disagree.","commentVisibility":"INTERNAL"}' \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('status now', d.get('status'), d.get('case_number'))"

echo "--- invalid transition (expect 409) ---"
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$B/cases/$cid/update" -H "authorization: Bearer $otok" \
  -H 'content-type: application/json' -d '{"status":"SUBMITTED","reason":"attempt invalid"}'

echo "--- case detail (officer) ---"
curl -s "$B/cases/$cid" -H "authorization: Bearer $otok" | python3 -c "
import sys,json;d=json.load(sys.stdin)
print('events', [e['event_type'] for e in d['events']])
print('comments', len(d['comments']))
print('transitions', d['availableTransitions'])"

echo "--- citizen case detail (internal comment must be hidden) ---"
curl -s "$B/cases/$cid" -H "authorization: Bearer $tok" | python3 -c "
import sys,json;d=json.load(sys.stdin)
print('comments visible', len(d['comments']), '| maskingApplied', d['maskingApplied'])"

echo "--- audit trail for the case ---"
curl -s "$B/audit?entityId=$cid" -H "authorization: Bearer $otok" | python3 -c "
import sys,json;d=json.load(sys.stdin)
print('audit entries', [a['action'] for a in d['items']])"

echo "--- parcel timeline after the case ---"
curl -s "$B/parcels/PARC-B/timeline" -H "authorization: Bearer $otok" | python3 -c "
import sys,json;d=json.load(sys.stdin)
print('timeline kinds', sorted(set(e['kind'] for e in d['items'])))"

echo "--- officer dashboard cards ---"
curl -s "$B/officer" -H "authorization: Bearer $otok" | python3 -c "
import sys,json;d=json.load(sys.stdin)
print(d['scope'], d['cards'])"

echo "--- analytics ---"
curl -s "$B/analytics" -H "authorization: Bearer $otok" | python3 -c "
import sys,json;d=json.load(sys.stdin)
print('dataset', d['datasetLabel'], '| kpis', {k:v for k,v in d['kpis'].items() if k in ('totalParcels','integrityFindings','highRiskParcels','openCases','averageQualityScore')})
print('byRule', d['distributions']['findingsByRule'])"

echo "--- geojson ---"
curl -s "$B/geojson" | python3 -c "
import sys,json;d=json.load(sys.stdin)
print('features', len(d['features']), '| first props', d['features'][0]['properties'])"

echo "--- data sources (no live probe) ---"
curl -s "$B/data-sources" | python3 -c "
import sys,json;d=json.load(sys.stdin)
print('sources', len(d['items']))
print(sorted(set(s['status'] for s in d['items'])))"

echo "--- department gateway ---"
curl -s "$B/gateway" -H "authorization: Bearer $otok" | python3 -c "
import sys,json;d=json.load(sys.stdin)
print([(x['department'], x['adapter']['status'], x['openCases']) for x in d['departments']])"

echo "--- rules (configurable, auditable) ---"
curl -s "$B/rules" | python3 -c "
import sys,json;d=json.load(sys.stdin)
print([(r['rule_code'], r['severity'], r['deduction']) for r in d['items']])"

echo "--- explicit unavailability (no fake features) ---"
curl -s "$B/unavailable/ai-assistant" | python3 -c "
import sys,json;d=json.load(sys.stdin)
print('unavailable', d['unavailable'], '| configurationDependent', d['configurationDependent'])"

echo "--- unauthorized check (expect 401) ---"
curl -s -o /dev/null -w "%{http_code}\n" "$B/officer"
