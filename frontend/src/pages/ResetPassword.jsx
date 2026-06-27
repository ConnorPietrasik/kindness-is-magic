import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { resetPasswordRequest } from '../lib/api';

export default function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await resetPasswordRequest(token, newPassword);
      setSuccess(true);

      // Auto-redirect to login after 3 seconds
      setTimeout(() => navigate('/login'), 3000);
    } catch (err) {
      setError(err.response?.data?.detail || 'Reset failed. The token may be invalid or expired.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 bg-gradient-to-br from-page-start to-page-end">
        <div className="w-full max-w-sm rounded-2xl bg-white px-8 py-10 text-center shadow-lg">
          <h1 className="mb-2 text-2xl font-bold text-brand-dark">✓ Password Reset!</h1>
          <p className="mb-4 text-sm text-gray-700">
            Your password has been updated. Redirecting to login…
          </p>
          <Link to="/login" className="text-btn-start hover:underline">
            Go to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-gradient-to-br from-page-start to-page-end">
      <div className="w-full max-w-sm rounded-2xl bg-white px-8 py-10 text-center shadow-lg">
        <h1 className="mb-1 text-2xl font-bold text-brand-dark">Reset Password</h1>
        <p className="mb-6 text-sm text-gray-500">Enter your new password below.</p>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-600">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-4 text-left">
            <label htmlFor="rp-new" className="mb-1.5 block text-sm font-medium text-gray-700">
              New Password
            </label>
            <input
              id="rp-new"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-base outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
              placeholder="Min 8 characters"
            />
          </div>

          <div className="mb-4 text-left">
            <label htmlFor="rp-confirm" className="mb-1.5 block text-sm font-medium text-gray-700">
              Confirm Password
            </label>
            <input
              id="rp-confirm"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-base outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
              placeholder="Re-enter password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full rounded-lg bg-gradient-to-r from-btn-start to-btn-end py-2.5 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Resetting…' : 'Reset Password'}
          </button>
        </form>

        <p className="mt-4 text-sm">
          <Link to="/login" className="text-btn-start hover:underline">
            ← Back to login
          </Link>
        </p>
      </div>
    </div>
  );
}
