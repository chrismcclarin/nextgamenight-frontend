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
        message: '✅ Client error sent to Sentry! Check your Sentry dashboard.'
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
      message: '✅ Unhandled error triggered. Check your Sentry dashboard.'
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
        message: '✅ Async error sent to Sentry! Check your Sentry dashboard.'
      });
    }
  };

  const testCustomMessage = () => {
    Sentry.captureMessage('Test message from Sentry integration', 'info');
    setTestResults({
      ...testResults,
      message: '✅ Custom message sent to Sentry! Check your Sentry dashboard.'
    });
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-md p-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Sentry Error Tracking Test</h1>
        <p className="text-gray-600 mb-6">
          Use these buttons to test different types of errors and verify they appear in your Sentry dashboard.
        </p>

        <div className="space-y-4 mb-6">
          <button
            onClick={testClientError}
            className="w-full bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700 transition-colors font-semibold"
          >
            Test Client-Side Error (Handled)
          </button>

          <button
            onClick={testUnhandledError}
            className="w-full bg-orange-600 text-white px-6 py-3 rounded-lg hover:bg-orange-700 transition-colors font-semibold"
          >
            Test Unhandled Error
          </button>

          <button
            onClick={testAsyncError}
            className="w-full bg-yellow-600 text-white px-6 py-3 rounded-lg hover:bg-yellow-700 transition-colors font-semibold"
          >
            Test Async Error
          </button>

          <button
            onClick={testCustomMessage}
            className="w-full bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors font-semibold"
          >
            Test Custom Message
          </button>
        </div>

        {testResults.message && (
          <div className={`p-4 rounded-lg ${
            testResults.message.includes('✅') 
              ? 'bg-green-50 text-green-800 border border-green-200' 
              : 'bg-blue-50 text-blue-800 border border-blue-200'
          }`}>
            <p className="font-medium">{testResults.message}</p>
          </div>
        )}

        <div className="mt-6 p-4 bg-gray-50 rounded-lg">
          <h2 className="font-semibold text-gray-900 mb-2">What to Check:</h2>
          <ol className="list-decimal list-inside space-y-1 text-gray-700">
            <li>Click any test button above</li>
            <li>Wait 2-5 seconds</li>
            <li>Go to your <a href="https://sentry.io" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Sentry Dashboard</a></li>
            <li>Check the "Issues" tab - you should see the errors appear</li>
            <li>Click on an error to see detailed information</li>
          </ol>
        </div>

        <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-sm text-yellow-800">
            <strong>Note:</strong> Make sure <code className="bg-yellow-100 px-1 rounded">NEXT_PUBLIC_SENTRY_DSN</code> is set in your <code className="bg-yellow-100 px-1 rounded">.env.local</code> file.
          </p>
        </div>
      </div>
    </div>
  );
}


