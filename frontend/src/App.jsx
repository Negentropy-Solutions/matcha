import { useEffect } from 'react';
import { useAppStore } from './store';
import Nav from './components/Nav';
import Toasts from './components/Toasts';
import { XcoModal, UndoModal, HistoryViewModal } from './components/Modals';
import ReconcileView from './components/ReconcileView';
import ExceptionsView from './components/ExceptionsView';
import HistoryView from './components/HistoryView';

export default function App() {
  const {
    currentTab,
    currentCompany,
    loadPayments,
    loadExceptions,
    exceptionsTotalInSystem,
    dashboardStats,
  } = useAppStore();

  // Initial load — also fetch exceptions to populate the badge count immediately
  useEffect(() => {
    if (currentCompany) {
      loadPayments();
      loadExceptions(1, 1);
    }
  }, []); // eslint-disable-line

  const excCount =
    dashboardStats?.exceptions_count != null
      ? dashboardStats.exceptions_count
      : exceptionsTotalInSystem || 0;

  return (
    <div className="matcha-page">
      <Nav excCount={excCount} />

      <ReconcileView visible={currentTab === 'Reconcile'} />
      <ExceptionsView visible={currentTab === 'Exceptions'} />
      <HistoryView visible={currentTab === 'History'} />

      <XcoModal />
      <UndoModal />
      <HistoryViewModal />
      <Toasts />
    </div>
  );
}
