export const metadata = {
  title: 'Terms of Service — Next Game Night',
};

export default function TermsOfService() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-16">
      <h1 className="text-4xl font-bold text-emerald-900 mb-2">Terms of Service</h1>
      <p className="text-sm text-gray-500 mb-10">Last updated: February 2026</p>

      <div className="prose prose-gray max-w-none space-y-8 text-gray-700 leading-relaxed">

        <section>
          <h2 className="text-xl font-bold text-emerald-900 mb-3">Using the app</h2>
          <p>
            Next Game Night is a free app for tracking board game sessions and coordinating
            game nights with friends. By using it, you agree to use it for that purpose and
            not to misuse it or attempt to harm other users or the service.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-emerald-900 mb-3">Your content</h2>
          <p>
            You own the content you create — your groups, events, game logs, and reviews.
            By using the app you give us permission to store and display that content to
            you and members of your groups.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-emerald-900 mb-3">Accounts</h2>
          <p>
            You sign in through Google. You are responsible for keeping your account secure.
            We reserve the right to suspend accounts that are used abusively or in violation
            of these terms.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-emerald-900 mb-3">Availability</h2>
          <p>
            We do our best to keep the app running but cannot guarantee uninterrupted
            availability. We may update, change, or discontinue features at any time.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-emerald-900 mb-3">Limitation of liability</h2>
          <p>
            Next Game Night is provided as-is. We are not liable for any loss or damage
            arising from your use of the app.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-emerald-900 mb-3">Contact</h2>
          <p>
            Questions? Reach us through the feedback link in the footer of the app.
          </p>
        </section>

      </div>
    </div>
  );
}
