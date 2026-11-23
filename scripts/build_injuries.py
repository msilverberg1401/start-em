"""Mark players who were usually good but hurt that season (adds "hurt": games missed to rolls.json).
Usage: python3 scripts/build_injuries.py supabase/functions/game/rolls.json supabase/functions/game/rolls.json
Data: nflverse weekly rosters (injured reserve / PUP, 2002+, filled in from 2020) and injury reports (Out/Doubtful, 2009+).
Before 2009 there is no injury data, so those seasons never get the tag."""
import pandas as pd, json, collections, sys, os, urllib.request
D=os.environ.get('INJ_CACHE','/tmp/nflverse-inj'); os.makedirs(D,exist_ok=True)
U='https://github.com/nflverse/nflverse-data/releases/download/'
for y in range(2002,2026):
    for kind,pre,ok in (('weekly_rosters/roster_weekly_','r',True),('injuries/injuries_','i',y>=2009)):
        f=f'{D}/{pre}{y}.csv'
        if ok and not os.path.exists(f): urllib.request.urlretrieve(f'{U}{kind}{y}.csv',f)
rolls=json.load(open(sys.argv[1]))
reg=lambda s: 18 if s>=2021 else 17
rs=[]
for y in range(2002,2026):
    r=pd.read_csv(f'{D}/r{y}.csv',low_memory=False,usecols=['season','week','gsis_id','status','status_description_abbr'])
    r=r[(r.status=='RES')&r.status_description_abbr.isin(['R01','R48','R04'])&(r.week<=reg(y))]
    rs.append(r[['season','week','gsis_id']])
for y in range(2009,2026):
    i=pd.read_csv(f'{D}/i{y}.csv',low_memory=False)
    i=i[(i.game_type=='REG')&i.report_status.isin(['Out','Doubtful'])]
    rs.append(i[['season','week','gsis_id']])
w=pd.concat(rs).drop_duplicates()
inj=w.groupby(['season','gsis_id']).week.nunique().to_dict()
print('R01 by season', pd.concat(rs[:24]).groupby('season').size().to_dict(), file=sys.stderr)
by=collections.defaultdict(list)
for r in rolls:
    for p in r['players']: by[p['id']].append((r['season'],p))
out=[]
tot=collections.Counter()
for r in rolls:
    for p in r['players']: tot[(r['season'],p['id'])]+=p['g']

for r in rolls:
    for p in r['players']:
        s=r['season']; n=inj.get((s,p['id']),0)
        p.pop('hurt',None)
        missed=(16 if s<2021 else 17)-tot[(s,p['id'])]
        if s>=2020: ok = n>=4 and missed>=3
        elif s>=2009: ok = n>=1 and missed>=4
        else: ok = False  # no injury data before 2009, so no tag
        if not ok: continue
        n=missed
        full=[x for (ss,x) in by[p['id']] if ss!=s and x['g']>=10]
        cut=12 if p['pos'] in('QB','TE') else 24
        good=sum(1 for x in full if x['rank']<=cut)
        if good>=2 and good*2>=len(full):
            p['hurt']=n; out.append((s,r['team'],p['name'],p['g'],n,p['rank']))
json.dump(rolls,open(sys.argv[2],'w'),separators=(',',':'))
print(len(out))
for o in sorted(out,key=lambda o:-o[0])[:40]: print(o)
import random; random.seed(3); print(random.sample(out,15))
