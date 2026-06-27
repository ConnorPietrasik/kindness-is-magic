import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { changePasswordRequest } from '../lib/api';
import { useState } from 'react';
import { HeaderBar, LogoutButton } from '../components/HeaderBar';
import { Card } from '../components/Card';
import { ErrorBox } from '../components/ErrorBox';
import FormField from '../components/FormField';
import Button from '../components/Button';
import { humanize } from '../lib/utils';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const roleColors = {
    admin: 'bg-red-600',
    referrer: 'bg-blue-600',
    family: 'bg-green-600',
  };

  const badgeClass = `${roleColors[user?.role] ?? 'bg-gray-500'} inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white`;

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar
        title="Kindness is Magic"
        right={<LogoutButton onClick={handleLogout} />}
      />

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        {/* Welcome card */}
        <Card className="mb-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Welcome back!</h2>
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-btn-start to-btn-end text-lg font-bold text-white">
              {user?.email?.[0]?.toUpperCase() || '?'}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold text-gray-900">{user?.email}</span>
                <span className={badgeClass}>{humanize(user?.role)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                {user?.referrer_id && <span>Referrer ID: {user.referrer_id}</span>}
                {user?.family_id && <span>Family ID: {user.family_id}</span>}
              </div>
            </div>
          </div>
        </Card>

        {/* Navigation cards */}
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {user?.role === 'admin' && (
            <>
              <NavCard to="/register" icon="👤" label="Register Users" desc="Create new accounts" />
              <NavCard to="/admin/referrers" icon="👥" label="Manage Referrers" desc="Create, edit, delete referrers" />
              <NavCard to="/admin/families" icon="🏠" label="Manage Families" desc="Create, edit, delete families" />
              <NavCard to="/admin/people" icon="✨" label="Manage People" desc="Create, edit, delete people" />
              <NavCard to="/admin/csv-upload" icon="📊" label="CSV Import" desc="Bulk-import referrers, families, people & users" />
            </>
          )}

          {user?.role === 'referrer' && (
            <NavCard to="/referrer/dashboard" icon="🏠" label="My Families" desc="Manage your families and members" />
          )}

          {user?.role === 'family' && (
            <NavCard to="/family/dashboard" icon="✨" label="My Family" desc="View your profile and manage people" />
          )}
        </div>

        {/* Change password */}
        <ChangePasswordSection />
      </main>
    </div>
  );
}

/**
 * NavCard — clickable nav card with icon, label and description.
 */
function NavCard({ to, icon, label, desc }) {
  return (
    <Link
      to={to}
      className="group flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-btn-start/40 hover:shadow-md"
    >
      <span className="text-2xl">{icon}</span>
      <span className="text-sm font-semibold text-gray-900 group-hover:text-btn-start">{label}</span>
      <span className="text-xs text-gray-400">{desc}</span>
    </Link>
  );
}

/**
 * ChangePasswordSection — form to change the user's password.
 */
function ChangePasswordSection() {
  const [oldPass, setOldPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');

    if (newPass !== confirmPass) {
      setMessage('New passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await changePasswordRequest(oldPass, newPass);
      setMessage('Password updated successfully!');
      setOldPass('');
      setNewPass('');
      setConfirmPass('');
    } catch (err) {
      setMessage(err.response?.data?.detail || 'Failed to change password.');
    } finally {
      setLoading(false);
    }
  };

  const isOk = message.toLowerCase().includes('success');

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold text-gray-900">Change Password</h2>
      {message && <ErrorBox variant={isOk ? 'success' : 'error'} message={message} className="mb-4" />}
      <form onSubmit={handleSubmit} className="max-w-sm space-y-3">
        <FormField label="Current password" type="password" fieldProps={{ value: oldPass, onChange: (e) => setOldPass(e.target.value), required: true }} />
        <FormField label="New password" type="password" fieldProps={{ value: newPass, onChange: (e) => setNewPass(e.target.value), required: true, minLength: 8, placeholder: 'Min 8 characters' }} />
        <FormField label="Confirm new password" type="password" fieldProps={{ value: confirmPass, onChange: (e) => setConfirmPass(e.target.value), required: true, minLength: 8 }} />
        <Button type="submit" loading={loading}>
          {loading ? 'Updating…' : 'Update Password'}
        </Button>
      </form>
    </Card>
  );
}
