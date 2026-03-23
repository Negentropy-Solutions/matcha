import LeftPanel from './LeftPanel';
import RightPanel from './RightPanel';

export default function ReconcileView({ visible }) {
  return (
    <div className="matcha-app" id="reconcileView" style={visible ? {} : { display: 'none' }}>
      <LeftPanel />
      <RightPanel />
    </div>
  );
}
