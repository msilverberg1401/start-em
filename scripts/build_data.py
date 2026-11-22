"""Build team-season roll pool from nflverse weekly stats (REG season, full PPR).
Usage: python3 build_data.py <dir with w_YYYY.csv> <out json>"""
import sys, json, glob, os
import pandas as pd

src, out = sys.argv[1], sys.argv[2]
POS = {'QB':'QB','RB':'RB','FB':'RB','WR':'WR','TE':'TE'}
KEEP = {'QB':4,'RB':7,'WR':8,'TE':4}   # Ranked shows all of these; other modes show the top 3/5/6/3
TIER = {p:(5,12,24) for p in ('QB','RB','WR','TE')}   # casual hint: top 5 / top 12 / top 24 / deeper at the position

def team_name(t, y):
    base = {'ARI':'Arizona Cardinals','ATL':'Atlanta Falcons','BAL':'Baltimore Ravens','BUF':'Buffalo Bills','CAR':'Carolina Panthers','CHI':'Chicago Bears','CIN':'Cincinnati Bengals','CLE':'Cleveland Browns','DAL':'Dallas Cowboys','DEN':'Denver Broncos','DET':'Detroit Lions','GB':'Green Bay Packers','HOU':'Houston Texans','IND':'Indianapolis Colts','JAX':'Jacksonville Jaguars','KC':'Kansas City Chiefs','MIA':'Miami Dolphins','MIN':'Minnesota Vikings','NE':'New England Patriots','NO':'New Orleans Saints','NYG':'New York Giants','NYJ':'New York Jets','PHI':'Philadelphia Eagles','PIT':'Pittsburgh Steelers','SEA':'Seattle Seahawks','SF':'San Francisco 49ers','TB':'Tampa Bay Buccaneers','TEN':'Tennessee Titans'}
    if t in base: return base[t], t
    if t=='LA':  return ('St. Louis Rams','STL') if y<=2015 else ('Los Angeles Rams','LAR')
    if t=='LAC': return ('San Diego Chargers','SD') if y<=2016 else ('Los Angeles Chargers','LAC')
    if t=='LV':  return ('Oakland Raiders','OAK') if y<=2019 else ('Las Vegas Raiders','LV')
    if t=='WAS':
        if y<=2019: return 'Washington Redskins','WAS'
        if y<=2021: return 'Washington Football Team','WAS'
        return 'Washington Commanders','WAS'
    raise ValueError(t)

frames=[]
for f in sorted(glob.glob(os.path.join(src,'w_*.csv'))):
    d=pd.read_csv(f,low_memory=False,usecols=['player_id','player_display_name','position','season','week','season_type','team','game_id','fantasy_points_ppr','headshot_url','attempts','carries','receptions'])
    d=d[(d.season_type=='REG') & d.position.isin(POS)]
    frames.append(d)
w=pd.concat(frames,ignore_index=True); w['pos']=w.position.map(POS)
w['fantasy_points_ppr']=w.fantasy_points_ppr.fillna(0)

# Some seasons (mostly 2001-02) tag away weeks with the opponent's team. Each game_id holds both
# teams, so a player's real team is the candidate that keeps showing up across his weeks.
NORM={'STL':'LA','SD':'LAC','OAK':'LV','LAR':'LA'}
def cands(gid):
    parts=str(gid).split('_')
    return {NORM.get(parts[2],parts[2]),NORM.get(parts[3],parts[3])} if len(parts)>=4 else set()
w['cands']=w.game_id.map(cands)
fixed={}
for (_,_),grp in w.groupby(['season','player_id'],sort=False):
    cnt={}
    for c in grp.cands:
        for t in c: cnt[t]=cnt.get(t,0)+1
    for i,t,c in zip(grp.index,grp.team,grp.cands):
        if t in c and len(c)==2:
            other=(c-{t}).pop()
            fixed[i]=other if cnt[other]>cnt[t] else t
        else:
            fixed[i]=max(c,key=lambda x:cnt[x]) if c and t not in c else t
w['team']=pd.Series(fixed)

# per player-team-season (stint)
g=(w.groupby(['season','team','player_id']).agg(name=('player_display_name','last'),pos=('pos','last'),
     pts=('fantasy_points_ppr','sum'),games=('week','nunique'),head=('headshot_url','last'),
     att=('attempts','sum'),car=('carries','sum'),rec=('receptions','sum')).reset_index())
# a player's primary position for the season
g['pos']=g.groupby(['season','player_id']).pos.transform(lambda s:s.mode().iat[0])
# positional finish (by full season total across teams)
tot=g.groupby(['season','player_id','pos']).pts.sum().reset_index()
tot['rank']=tot.groupby(['season','pos']).pts.rank(ascending=False,method='min').astype(int)
g=g.merge(tot[['season','player_id','rank']],on=['season','player_id'])
# tier hint uses points with THIS team, so a traded player's hint matches what the roll can give you
g['stint_rank']=g.groupby(['season','pos']).pts.rank(ascending=False,method='min').astype(int)

first_season=g.groupby('player_id').season.transform('min')
g['rookie']=(g.season==first_season)&(g.season>1999)
# NFL experience from nflverse player records (rookie season); fall back to first season in our data
players_csv=os.path.join(src,'players.csv')
rookie=pd.read_csv(players_csv,usecols=['gsis_id','rookie_season']).dropna().drop_duplicates('gsis_id').set_index('gsis_id').rookie_season if os.path.exists(players_csv) else pd.Series(dtype=float)
rs=g.player_id.map(rookie)
g['yr']=(g.season-rs+1).where(rs.notna() & (rs<=g.season), (g.season-first_season+1).where(first_season>1999))

def usage(p, r):
    gp = max(int(r.games), 1)
    pg = lambda v: round(float(v or 0) / gp, 1)
    if p == 'QB': return {'att': pg(r.att), 'car': pg(r.car)}
    if p == 'RB': return {'car': pg(r.car), 'rec': pg(r.rec)}
    return {'rec': pg(r.rec)}

rolls=[]
for (y,t),grp in g.groupby(['season','team']):
    full,abbr=team_name(t,y)
    players=[]
    for p,k in KEEP.items():
        sub=grp[grp.pos==p].sort_values('pts',ascending=False).head(k)
        for d,r in enumerate(sub.itertuples()):
            if r.pts<=0 and len(players)>0: continue
            a,b,c=TIER[p]
            sr=r.stint_rank
            tier = 'elite' if sr<=a else 'starter' if sr<=b else 'flex' if sr<=c else 'depth'
            players.append(dict(id=r.player_id,name=r.name,pos=p,pts=round(float(r.pts),1),g=int(r.games),
                ppg=round(float(r.pts)/max(int(r.games),1),1),rank=int(r.rank),tier=tier,
                head=r.head if isinstance(r.head,str) else None, d=d,
                yr=(int(r.yr) if r.yr==r.yr else None),
                # usage per game for Casual's stats-on view (opportunity, not results)
                u=usage(p, r)))
    rolls.append(dict(key=f'{y}-{abbr}',season=int(y),team=abbr,teamName=full,players=players))
# shorten headshot URLs: game.ts expands "p:"/"u:" back to the full nfl.com address
PRE={'https://static.www.nfl.com/image/private/f_auto,q_auto/league/':'p:','https://static.www.nfl.com/image/upload/f_auto,q_auto/league/':'u:'}
for r in rolls:
    for pl in r['players']:
        h=pl.get('head')
        for full,short in PRE.items():
            if h and h.startswith(full): pl['head']=short+h[len(full):]
json.dump(rolls,open(out,'w'),separators=(',',':'))
print(len(rolls),'team-seasons', os.path.getsize(out)//1024,'KB')
