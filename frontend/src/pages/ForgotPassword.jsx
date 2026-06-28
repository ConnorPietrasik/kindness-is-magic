import { useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotPasswordRequest } from '../lib/api';
import { ROUTES } from '../lib/routes';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await forgotPasswordRequest(email);
      setSubmitted(true);
    } catch (err) {
      setError(err.response?.data?.detail || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 bg-gradient-to-br from-page-start to-page-end">
        <div className="w-full max-w-sm rounded-2xl bg-white px-8 py-10 text-center shadow-lg">
          <h1 className="mb-2 text-2xl font-bold text-brand-dark">Check Your Email</h1>
          <p className="mb-4 text-sm text-gray-700">
            If an account exists for <strong>{email}</strong>, a password reset link has been sent.
          </p>
          <p className="mb-4 rounded bg-gray-50 px-3 py-2 text-xs text-gray-400">
            <em>Dev note: Check the backend logs for the reset token.</em>
          </p>
          <Link to={ROUTES.LOGIN} className="text-btn-start hover:underline">
            ← Back to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-gradient-to-br from-page-start to-page-end">
      <div className="w-full max-w-sm rounded-2xl bg-white px-8 py-10 text-center shadow-lg">
        <h1 className="mb-1 text-2xl font-bold text-brand-dark">Forgot Password?</h1>
        <p className="mb-6 text-sm text-gray-500">
          Enter your email and we&apos;ll send you a reset link.
        </p>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-600">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-4 text-left">
            <label htmlFor="fp-email" className="mb-1.5 block text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              id="fp-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-base outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
              placeholder="you@example.com"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full rounded-lg bg-gradient-to-r from-btn-start to-btn-end py-2.5 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Sending…' : 'Send Reset Link'}
          </button>
        </form>

        <p className="mt-4 text-sm">
          <Link to={ROUTES.LOGIN} className="text-btn-start hover:underline">
            ← Back to login
          </Link>
        </p>
      </div>
    </div>
  );
}
