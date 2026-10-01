import { Heading } from '../../components/ui/Heading';

export const metadata = {
  title: 'Terms of Service — Next Game Night',
};

export default function TermsOfService() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-16">
      <Heading level={1} size="display" className="text-content-primary mb-2">Terms of Service</Heading>
      <p className="text-sm text-content-muted mb-10">Last updated: April 2026</p>

      <div className="prose prose-gray max-w-none space-y-8 text-content-secondary leading-relaxed">

        <section>
          <Heading level={2} size="heading" className="text-content-primary mb-3">Using the app</Heading>
          <p>
            Next Game Night is a free app for tracking board game sessions and coordinating
            game nights with friends. By using it, you agree to use it for that purpose and
            not to misuse it or attempt to harm other users or the service.
          </p>
        </section>

        <section>
          <Heading level={2} size="heading" className="text-content-primary mb-3">Your content</Heading>
          <p>
            You own the content you create — your groups, events, game logs, and reviews.
            By using the app you give us permission to store and display that content to
            you and members of your groups.
          </p>
        </section>

        <section>
          <Heading level={2} size="heading" className="text-content-primary mb-3">Accounts</Heading>
          <p>
            You sign in through Google. You are responsible for keeping your account secure.
            We reserve the right to suspend accounts that are used abusively or in violation
            of these terms.
          </p>
        </section>

        <section>
          <Heading level={2} size="heading" className="text-content-primary mb-3">Google Calendar</Heading>
          <p>
            You may optionally connect your Google Calendar to sync events and share
            your availability with group members. This connection is entirely optional
            and can be disconnected at any time from your profile settings. When you
            disconnect, we delete your stored Google tokens and stop accessing your
            calendar data.
          </p>
          <p className="mt-3">
            {"Next Game Night's use and transfer of information received from Google APIs adheres to the "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-content-accent underline hover:text-content-accent-hover"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
        </section>

        <section>
          <Heading level={2} size="heading" className="text-content-primary mb-3">SMS notifications</Heading>
          <p>
            SMS notifications are an optional feature. To use them, you must provide your mobile
            phone number, verify it with a one-time code, and explicitly enable SMS in your
            notification preferences. By doing so, you consent to receive recurring text messages
            from Next Game Night about your game group activity.
          </p>
          <p className="mt-3">
            You may receive SMS messages for the following events: when a new game night is
            scheduled, when an event time or details change, when an event is cancelled, and as
            a reminder shortly before an event begins. Message frequency varies based on your
            group&apos;s activity.
          </p>
          <p className="mt-3">
            <strong>Message and data rates may apply.</strong> You are responsible for any
            charges from your mobile carrier. Consent to receive SMS messages is not a condition
            of using Next Game Night — all features remain available if you choose not to
            enable SMS.
          </p>
          <p className="mt-3">
            You can opt out at any time by replying <strong>STOP</strong> to any text message
            you receive from us, or by toggling SMS notifications off in your profile settings.
            For help, reply <strong>HELP</strong> to any message. We use Twilio as our SMS
            delivery provider.
          </p>
        </section>

        <section>
          <Heading level={2} size="heading" className="text-content-primary mb-3">Availability</Heading>
          <p>
            We do our best to keep the app running but cannot guarantee uninterrupted
            availability. We may update, change, or discontinue features at any time.
          </p>
        </section>

        <section>
          <Heading level={2} size="heading" className="text-content-primary mb-3">Limitation of liability</Heading>
          <p>
            Next Game Night is provided as-is. We are not liable for any loss or damage
            arising from your use of the app.
          </p>
        </section>

        <section>
          <Heading level={2} size="heading" className="text-content-primary mb-3">Contact</Heading>
          <p>
            Questions? Reach us through the feedback link in the footer of the app.
          </p>
        </section>

      </div>
    </div>
  );
}
