export const metadata = {
  title: 'Privacy Policy — Next Game Night',
};

export default function PrivacyPolicy() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-16">
      <h1 className="text-4xl font-bold text-content-primary mb-2">Privacy Policy</h1>
      <p className="text-sm text-content-muted mb-10">Last updated: April 2026</p>

      <div className="prose prose-gray max-w-none space-y-8 text-content-secondary leading-relaxed">

        <section>
          <h2 className="text-xl font-bold text-content-primary mb-3">What we collect</h2>
          <p>
            When you sign in with Google, we receive your name, email address, and profile picture
            from your Google account. We store this to identify you within the app.
          </p>
          <p className="mt-3">
            Everything else we store is data you create yourself: groups you form, events you
            schedule, games you log, reviews you write, and availability you submit.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-content-primary mb-3">How we use your data</h2>
          <p>
            Your data is used only to make the app work for you and your group. We use it to:
          </p>
          <ul className="list-disc list-inside mt-3 space-y-1">
            <li>Show you your groups, events, and game history</li>
            <li>Let group members see shared schedules and game logs</li>
            <li>Send availability reminder emails when your group schedules a game night</li>
          </ul>
          <p className="mt-3">
            We do not sell your data, share it with third parties for advertising, or use it
            for any purpose beyond operating this app.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-content-primary mb-3">Google Calendar integration</h2>
          <p>
            If you choose to connect your Google Calendar, we request access to read your calendar
            data and create or manage calendar events. Specifically, we use the following Google API scopes:
          </p>
          <ul className="list-disc list-inside mt-3 space-y-1">
            <li><strong>calendar.readonly</strong> — to read your free/busy times and display them on group availability heatmaps</li>
            <li><strong>calendar.events</strong> — to sync game night events to your Google Calendar</li>
          </ul>
          <p className="mt-3">
            Your Google Calendar data is used solely to power the scheduling features within this app.
            We access only the calendar information needed to show your availability to your group
            and to sync events you create.
          </p>
          <p className="mt-3">
            <strong>We do not share, transfer, or disclose your Google user data to any third party.</strong>{' '}
            Your Google Calendar data is not sold, used for advertising, or provided to any
            external service. It is stored securely on our servers and used only to operate
            the features described above.
          </p>
          <p className="mt-3">
            You can disconnect your Google Calendar at any time from your profile settings.
            When you disconnect, we delete your stored Google authentication tokens and stop
            accessing your calendar data.
          </p>
          <p className="mt-3">
            {"Next Game Night's use and transfer of information received from Google APIs adheres to the "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline hover:text-accent-hover"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-content-primary mb-3">Emails</h2>
          <p>
            We may send you emails when your group requests your availability for an upcoming
            game night. You will not receive marketing emails. If you no longer want to receive
            availability reminders, contact us and we will remove you.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-content-primary mb-3">Data storage</h2>
          <p>
            Your data is stored in a secure PostgreSQL database. We take reasonable steps to
            protect it, but no internet service can guarantee absolute security.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-content-primary mb-3">Deleting your data</h2>
          <p>
            You can delete your account and all associated data at any time by contacting us.
            We will remove your data promptly.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-content-primary mb-3">Contact</h2>
          <p>
            Questions? Reach us through the feedback link in the footer of the app.
          </p>
        </section>

      </div>
    </div>
  );
}
