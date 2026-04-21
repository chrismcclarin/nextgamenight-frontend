export const metadata = {
  title: 'About — Next Game Night',
};

export default function About() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-16">
      <h1 className="text-4xl font-bold text-content-primary mb-2">About Next Game Night</h1>
      <p className="text-sm text-content-muted mb-10">A project by Chris McClarin</p>

      <div className="prose prose-gray max-w-none space-y-8 text-content-secondary leading-relaxed">

        <section>
          <h2 className="text-xl font-bold text-content-primary mb-3">What is Next Game Night?</h2>
          <p>
            Next Game Night is a free web app that helps board game groups organize their game nights.
            Users can create groups, track their board game collections, schedule events, coordinate
            availability, and keep a history of what they&apos;ve played together.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-content-primary mb-3">How it works</h2>
          <p>
            Group organizers create events and invite members. The app provides tools for
            finding the best time to play, voting on which game to bring to the table, and
            syncing events with Google Calendar. Members can optionally receive SMS notifications
            about upcoming events so nobody misses game night.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-content-primary mb-3">About the developer</h2>
          <p>
            Next Game Night is built and maintained by Chris McClarin as an independent project.
            It grew out of a love for board games and the recurring challenge of getting a group
            together to play.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-content-primary mb-3">Contact</h2>
          <p>
            If you have questions, feedback, or need support, you can reach Chris directly
            at{' '}
            <a
              href="mailto:eternalrook@gmail.com"
              className="text-accent underline hover:text-accent-hover"
            >
              eternalrook@gmail.com
            </a>.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-content-primary mb-3">Legal</h2>
          <p>
            Read our{' '}
            <a href="/privacy" className="text-accent underline hover:text-accent-hover">
              Privacy Policy
            </a>{' '}
            and{' '}
            <a href="/terms" className="text-accent underline hover:text-accent-hover">
              Terms of Service
            </a>.
          </p>
        </section>

      </div>
    </div>
  );
}
