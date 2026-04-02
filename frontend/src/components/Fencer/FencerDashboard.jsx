import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { getMyProfile, getMyBouts, triggerScrape, getScrapeStatus } from '../../lib/api';
import { useTheme } from '../../hooks/useTheme';
import TopBar from '../Shared/TopBar';
import SectionTabs from '../Shared/SectionTabs';
import OverviewTab    from './tabs/OverviewTab';
import { PoolDETab }  from './tabs/PoolDETab';
import { RivalsTab }  from './tabs/PoolDETab';
import BoutHistoryTab from './tabs/BoutHistoryTab';
import MentalTab      from './tabs/MentalTab';
import RoutineTab     from './tabs/RoutineTab';
import AddTournamentTab from '../Shared/AddTournamentTab';
import EditTournamentTab from '../Shared/EditTournamentTab';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'poolde',   label: 'Pool vs DE' },
  { id: 'rivals',   label: 'Rivals' },
  { id: 'bouts',    label: 'Bout history' },
  { id: 'mental',   label: 'Mental checklist' },
  { id: 'routine',  label: 'Match-day routine' },
  { id: 'tournament', label: '+ Add tournament' },
  { id: 'edit',       label: '✏️ Edit results' },
];

export default function FencerDashboard() {
  const { theme: T } = useTheme();
  const { user, fencer: authFencer } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');
  const [profile,   setProfile]   = useState(null);
  const [bouts,     setBouts]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [syncing,   setSyncing]   = useState(false);
  const [lastSync,  setLastSync]  = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [profileData, boutsData, syncStatus] = await Promise.all([
        getMyProfile(),
        getMyBouts({ limit: 500 }),
        authFencer?.id ? getScrapeStatus(authFencer.id) : Promise.resolve(null),
      ]);
      setProfile(profileData);
      setBouts(boutsData.bouts || []);
      if (syncStatus) setLastSync(syncStatus.scraped_at);
    } catch (err) {
      console.error('Failed to load profile:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    if (!authFencer?.id || syncing) return;
    setSyncing(true);
    try {
      await triggerScrape(authFencer.id);
      setTimeout(loadData, 90000); // Reload after 90 seconds
    } catch (err) {
      alert(err.message);
    } finally {
      setTimeout(() => setSyncing(false), 5000);
    }
  }

  if (loading) return <LoadingScreen />;

  const { fencer, stats, competitions } = profile || {};

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'100vh', background:T.black }}>
      <TopBar />
      <SectionTabs tabs={TABS} active={activeTab} onChange={setActiveTab} />

      {/* Sync button */}
      <div style={{ padding:'8px 14px 0', display:'flex', justifyContent:'flex-end' }}>
        <button
          onClick={handleSync}
          disabled={syncing}
          style={{
            fontSize: 11, padding: '4px 10px',
            background: 'transparent',
            border: `0.5px solid ${T.surface3}`,
            borderRadius: T.borderRadiusSm,
            color: syncing ? T.textTertiary : T.primary,
            cursor: syncing ? 'default' : 'pointer',
          }}
        >
          {syncing ? 'Syncing from UKRatings…' : '↻ Sync latest data'}
        </button>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {activeTab === 'overview' && (
          <OverviewTab fencer={fencer} stats={stats} competitions={competitions} />
        )}
        {activeTab === 'poolde' && (
          <PoolDETab stats={stats} />
        )}
        {activeTab === 'rivals' && (
          <RivalsTab rivals={stats?.rivals || []} />
        )}
        {activeTab === 'bouts' && (
          <BoutHistoryTab bouts={bouts} competitions={competitions} />
        )}
        {activeTab === 'mental' && (
          <MentalTab fencerId={fencer?.id} />
        )}
        {activeTab === 'routine' && (
          <RoutineTab cuephrase={fencer?.cue_phrase} />
        )}
        {activeTab === 'tournament' && (
          <AddTournamentTab />
        )}
        {activeTab === 'edit' && (
          <EditTournamentTab />
        )}
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div style={{
      minHeight: '100vh', background: T.black,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 16,
    }}>
      <div style={{
        width: 40, height: 40, background: T.primary,
        borderRadius: 10, display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 18, color: 'white', fontWeight: 500,
      }}>AF</div>
      <div style={{ fontSize: 14, color: T.textTertiary }}>Loading your dashboard…</div>
    </div>
  );
}
