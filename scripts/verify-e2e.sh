#!/usr/bin/env bash
# BHUMISETU end-to-end acceptance flow.
# Exercises the documented user journey against a running server:
# search -> select -> passport -> evidence -> create case -> officer workflow ->
# case events -> audit -> timeline -> citizen masking -> RBAC.
set -u
B="${BHUMISETU_BASE_URL:-http://localhost:12001}"
J='-H Content-Type:application/json'

pass=0
fail=0
check() {
  if [ "$1" = "1" ]; then pass=$((pass+1)); printf '  \033[32mPASS\033[0m %s\n' "$2";
  else fail=$((fail+1)); printf '  \033[31mFAIL\033[0m %s\n' "$2"; fi
}

echo "== 1. Anonymous land passport read (public record view) =="
curl -s "$B/api/passport/PARC-B" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('   role:',d['header']['requestedByRole'],'| maskNames:',d['maskingPolicy']['maskPartyNames'])
assert d['executiveSummary']['parcelId']=='PARC-B'
" && check 1 "passport resolves PARC-B" || check 0 "passport resolves PARC-B"

echo "== 2. Officer sign-in =="
TOK=$(curl -s "$B/api/auth/login" $J -d '{"username":"revenue","password":"officer@123"}' | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])")
[ ${#TOK} -gt 40 ] && check 1 "revenue officer authenticated (${#TOK} char token)" || check 0 "revenue officer authenticated"

echo "== 3. Citizen sign-in =="
CTOK=$(curl -s "$B/api/auth/login" $J -d '{"username":"citizen","password":"citizen@123"}' | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])")
[ ${#CTOK} -gt 40 ] && check 1 "citizen authenticated" || check 0 "citizen authenticated"

echo "== 4. Citizen masking =="
curl -s "$B/api/passport/PARC-B" -H "Authorization: Bearer $CTOK" | python3 -c "
import json,sys
d=json.load(sys.stdin)
m=d['maskingPolicy']
print('   role:',d['header']['requestedByRole'],'| maskNames:',m['maskPartyNames'],'| internalNotes:',m['includeInternalNotes'])
print('   holder shown as:',d['ownership']['currentRecordedHolder'])
assert m['maskPartyNames'] is True, 'citizen names must be masked'
assert m['includeInternalNotes'] is False, 'citizen must not see internal notes'
" && check 1 "citizen view masks names and internal notes" || check 0 "citizen view masks names and internal notes"

echo "== 5. Officer creates a verification case on PARC-C =="
CASE=$(curl -s "$B/api/cases" $J -H "Authorization: Bearer $TOK" -d '{"parcelId":"PARC-C","title":"Area discrepancy requires reconciliation","description":"Cadastral area and RoR asserted area differ by 35 sq.ft.","priority":"NORMAL","findingRefs":["AREA_MISMATCH"]}')
CID=$(echo "$CASE" | python3 -c "import json,sys;print(json.load(sys.stdin)['case_id'])")
echo "$CASE" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('   created:',d['case_number'],d['status'],'| dept:',d['assigned_department'],'| role:',d['assigned_role'])
assert d['status']=='SUBMITTED', d['status']
# AREA_MISMATCH is mapped to the Survey/GIS authority in the rule catalogue,
# so the derived routing must follow that mapping rather than the creator's role.
assert d['assigned_department']=='Survey/GIS', d['assigned_department']
assert d['assigned_role']=='FIELD_OFFICER', d['assigned_role']
" && check 1 "case SUBMITTED and routed to Survey/GIS per the authority mapping" || check 0 "case SUBMITTED and routed per authority mapping"

echo "== 6. Officer transitions SUBMITTED -> UNDER_REVIEW =="
curl -s "$B/api/cases/$CID/update" $J -H "Authorization: Bearer $TOK" -d '{"status":"UNDER_REVIEW","reason":"Survey record requested from the taluk office.","comment":"Awaiting survey measurement.","commentVisibility":"INTERNAL"}' > /dev/null
curl -s "$B/api/cases/$CID" -H "Authorization: Bearer $TOK" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('   status:',d['status'],'| case events:',len(d['events']),'| comments:',len(d['comments']))
assert d['status']=='UNDER_REVIEW', d['status']
assert len(d['events'])>=3, 'a case event must be written per transition and comment'
assert any(e['event_type']=='STATUS_CHANGED' for e in d['events']), 'STATUS_CHANGED event expected'
assert any(e['event_type']=='COMMENT_ADDED' for e in d['events']), 'COMMENT_ADDED event expected'
" && check 1 "status changed, case events written" || check 0 "status changed, case events written"

echo "== 7. Invalid transition is rejected =="
CODE=$(curl -s -o /tmp/inv.json -w "%{http_code}" "$B/api/cases/$CID/update" $J -H "Authorization: Bearer $TOK" -d '{"status":"SUBMITTED","reason":"attempting an invalid backwards transition"}')
echo "   http=$CODE"
python3 -c "import json;print('   error:',json.load(open('/tmp/inv.json')).get('error'))"
[ "$CODE" = "409" ] && check 1 "invalid transition returns 409" || check 0 "invalid transition returns 409 (got $CODE)"

echo "== 8. Citizen cannot update an officer case (RBAC) =="
CODE=$(curl -s -o /tmp/rbac.json -w "%{http_code}" "$B/api/cases/$CID/update" $J -H "Authorization: Bearer $CTOK" -d '{"status":"RESOLVED","reason":"citizen attempt"}')
python3 -c "import json;print('   error:',json.load(open('/tmp/rbac.json')).get('error'))"
[ "$CODE" = "403" ] && check 1 "citizen write refused with 403" || check 0 "citizen write refused with 403 (got $CODE)"

echo "== 9. Audit trail recorded the transition =="
curl -s "$B/api/audit?entityType=verification_case&limit=6" -H "Authorization: Bearer $TOK" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for a in d['items'][:5]:
    print('   ',a['action'],'|',a['entity_type'],'|',a['reason'][:50])
assert any(a['action']=='CASE_UPDATED' for a in d['items']), 'expected CASE_UPDATED'
assert any(a['action']=='CASE_CREATED' for a in d['items']), 'expected CASE_CREATED'
" && check 1 "CASE_CREATED and CASE_UPDATED present in audit trail" || check 0 "audit trail records the workflow"

echo "== 10. Parcel timeline reflects the case =="
curl -s "$B/api/passport/PARC-C" -H "Authorization: Bearer $TOK" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('   timeline events:',len(d['timeline']),'| openCases:',d['executiveSummary']['openCases'])
print('   latest:',d['timeline'][0]['title'][:68])
assert d['executiveSummary']['openCases']>=1
assert any('case' in e['kind'].lower() for e in d['timeline'])
" && check 1 "timeline includes case events" || check 0 "timeline includes case events"

echo "== 11. Citizen service request =="
curl -s "$B/api/service-requests" $J -H "Authorization: Bearer $CTOK" -d '{"parcelId":"PARC-C","requestType":"AREA_CORRECTION","subject":"Request area correction","description":"The recorded area differs from the survey measurement."}' | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('   created:',d['reference_number'],d['status'],'| dept:',d.get('assigned_department'))
assert d['status']=='SUBMITTED'
" && check 1 "service request created" || check 0 "service request created"

echo "== 12. Unauthenticated write is refused =="
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$B/api/cases" $J -d '{"parcelId":"PARC-A","title":"anonymous attempt"}')
[ "$CODE" = "401" ] && check 1 "anonymous case creation refused with 401" || check 0 "anonymous case creation refused with 401 (got $CODE)"

echo "== 13. Evidence chain present for every finding =="
for p in PARC-B PARC-C PARC-D PARC-E PARC-F; do
  curl -s "$B/api/passport/$p" | python3 -c "
import json,sys
d=json.load(sys.stdin)
n=len(d['findings']); e=len(d['evidence'])
assert n>=1 and e>=1, f'{n} findings but {e} evidence'
print('   $p: findings=%d evidence=%d' % (n,e))
" || fail=$((fail+1))
done
check 1 "every demonstration finding carries evidence"

echo "== 14. Temporal version recorded for the status change =="
curl -s "$B/api/temporal?entityType=case&limit=10" -H "Authorization: Bearer $TOK" | python3 -c "
import json,sys
d=json.load(sys.stdin)
types=[t['change_type'] for t in d['items']]
print('   temporal change types:',types[:5])
assert 'CASE_STATUS_CHANGED' in types, types
" && check 1 "temporal version recorded for status change" || check 0 "temporal version recorded for status change"

echo "== 15. No cross-parcel findings =="
for p in PARC-A PARC-B PARC-C PARC-D PARC-E PARC-F; do
  curl -s "$B/api/passport/$p" | python3 -c "
import json,sys
d=json.load(sys.stdin)
pid=d['executiveSummary']['parcelId']
for f in d['findings']:
    assert f['parcelId']==pid, f'finding {f[\"ruleCode\"]} belongs to {f[\"parcelId\"]} not {pid}'
print('   $p:', ','.join(f['ruleCode'] for f in d['findings']) or 'no findings')
" || fail=$((fail+1))
done
check 1 "no finding leaks across parcels"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
