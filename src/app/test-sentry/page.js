'use client';

import { useState } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function TestSentryPage() {
  const [testResults, setTestResults] = useState({
    clientError: false,
    serverError: false,
    message: ''
  });

  const testClientError = () => {
    try {
      setTestResults({ ...testResults, message: 'Triggering client error...' });
      // This will be caught by Sentry
      throw new Error('Test Sentry Error - Client Side');
    } catch (error) {
      Sentry.captureException(error);
      setTestResults({
        ...testResults,
        clientError: true,
        message: 'Client error sent to Sentry! Check your Sentry dashboard.'
      });
    }
  };

  const testUnhandledError = () => {
    setTestResults({ ...testResults, message: 'Triggering unhandled error...' });
    // This will be caught automatically by Sentry
    setTimeout(() => {
      throw new Error('Test Sentry Error - Unhandled Exception');
    }, 100);
    setTestResults({
      ...testResults,
      message: 'Unhandled error triggered. Check your Sentry dashboard.'
    });
  };

  const testAsyncError = async () => {
    try {
      setTestResults({ ...testResults, message: 'Triggering async error...' });
      await new Promise((resolve, reject) => {
        setTimeout(() => {
          reject(new Error('Test Sentry Error - Async Operation'));
        }, 100);
      });
    } catch (error) {
      Sentry.captureException(error);
      setTestResults({
        ...testResults,
        message: 'Async error sent to Sentry! Check your Sentry dashboard.'
      });
    }
  };

  const testCustomMessage = () => {
    Sentry.captureMessage('Test message from Sentry integration', 'info');
    setTestResults({
      ...testResults,
      message: 'Custom message sent to Sentry! Check your Sentry dashboard.'
    });
  };

  return (
    <div className="min-h-screen bg-surface-page p-8">
      <div className="max-w-2xl mx-auto bg-surface-card rounded-card shadow-theme-md p-6">
        <h1 className="text-3xl font-bold text-content-primary mb-4">Sentry Error Tracking Test</h1>
        <p className="text-content-secondary mb-6">
          Use these buttons to test different types of errors and verify they appear in your Sentry dashboard.
        </p>

        <div className="space-y-4 mb-6">
          <button
            onClick={testClientError}
            className="btn btn-danger w-full py-3 font-semibold"
          >
            Test Client-Side Error (Handled)
          </button>

          <button
            onClick={testUnhandledError}
            className="btn btn-danger w-full py-3 font-semibold"
          >
            Test Unhandled Error
          </button>

          <button
            onClick={testAsyncError}
            className="btn btn-danger w-full py-3 font-semibold"
          >
            Test Async Error
          </button>

          <button
            onClick={testCustomMessage}
            className="btn btn-primary w-full py-3 font-semibold"
          >
            Test Custom Message
          </button>
        </div>

        {testResults.message && (
          <div className="p-4 rounded-card bg-status-success/10 text-status-success border border-status-success/30">
            <p className="font-medium">{testResults.message}</p>
          </div>
        )}

        <div className="mt-6 p-4 bg-surface-elevated rounded-card">
          <h2 className="font-semibold text-content-primary mb-2">What to Check:</h2>
          <ol className="list-decimal list-inside space-y-1 text-content-secondary">
            <li>Click any test button above</li>
            <li>Wait 2-5 seconds</li>
            <li>Go to your <a href="https://sentry.io" target="_blank" rel="noopener noreferrer" className="text-content-link hover:text-content-link-hover">Sentry Dashboard</a></li>
            <li>Check the &quot;Issues&quot; tab - you should see the errors appear</li>
            <li>Click on an error to see detailed information</li>
          </ol>
        </div>

        <div className="mt-4 p-4 bg-status-warning/10 border border-status-warning/30 rounded-card">
          <p className="text-sm text-status-warning">
            <strong>Note:</strong> Make sure <code className="bg-surface-elevated px-1 rounded">NEXT_PUBLIC_SENTRY_DSN</code> is set in your <code className="bg-surface-elevated px-1 rounded">.env.local</code> file.
          </p>
        </div>
      </div>
    </div>
  );
}
