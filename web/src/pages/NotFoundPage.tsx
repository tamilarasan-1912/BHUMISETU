import { useNavigate } from 'react-router-dom';
import { EmptyState, GlassCard, CardHead } from '../components/ui';

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="page stack" style={{ maxWidth: 760 }}>
      <GlassCard>
        <CardHead title="Page not found" subtitle="This route does not exist in BHUMISETU" />
        <EmptyState
          title="Nothing is published at this address"
          icon="◻"
          body="The link may be out of date, or the record it pointed to may have been removed. Nothing has been silently redirected, so you can be sure you are not looking at the wrong record."
        />
        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/')}>
            Go to the map
          </button>
          <button type="button" className="btn" onClick={() => navigate('/parcels')}>
            Parcel register
          </button>
          <button type="button" className="btn" onClick={() => navigate('/intelligence')}>
            Intelligence workspace
          </button>
          <button type="button" className="btn" onClick={() => navigate('/sources')}>
            Data fabric
          </button>
        </div>
      </GlassCard>
    </div>
  );
}
