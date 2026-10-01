import { Heading } from '../../components/ui/Heading';

export const metadata = {
  title: 'About — Next Game Night',
};

export default function About() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-16">
      <Heading level={1} size="display" className="text-content-primary mb-2">About Next Game Night</Heading>
      <p className="text-sm text-content-muted mb-10">A project by Chris McClarin</p>

      <div className="prose prose-gray max-w-none space-y-8 text-content-secondary leading-relaxed">

        <section>
          <Heading level={2} size="heading" className="text-content-primary mb-3">What is Next Game Night?</Heading>
          <p>
            Next Game Night is a free web app that helps board game groups organize their game nights.
            Users can create groups, track their board game collections, schedule events, coordinate
            availability, and keep a history of what they&apos;ve played together.
          </p>
        </section>

        <section>
          <Heading level={2} size="heading" className="text-content-primary mb-3">How it works</Heading>
          <p>
            Group organizers create events and invite members. The app provides tools for
            finding the best time to play, voting on which game to bring to the table, and
            syncing events with Google Calendar. Members can optionally receive SMS notifications
            about upcoming events so nobody misses game night.
          </p>
        </section>

        <section>
          <Heading level={2} size="heading" className="text-content-primary mb-3">About the developer</Heading>
          <p>
            Next Game Night is built and maintained by Chris McClarin as an independent project.
            It grew out of a love for board games and the recurring challenge of getting a group
            together to play.
          </p>
        </section>

        <section>
          <Heading level={2} size="heading" className="text-content-primary mb-3">Contact</Heading>
          <p>
            If you have questions, feedback, or need support, you can reach Chris directly
            at{' '}
            <a
              href="mailto:eternalrook@gmail.com"
              className="text-content-accent underline hover:text-content-accent-hover"
            >
              eternalrook@gmail.com
            </a>.
          </p>
        </section>

        <section>
          <Heading level={2} size="heading" className="text-content-primary mb-3">Legal</Heading>
          <p>
            Read our{' '}
            <a href="/privacy" className="text-content-accent underline hover:text-content-accent-hover">
              Privacy Policy
            </a>{' '}
            and{' '}
            <a href="/terms" className="text-content-accent underline hover:text-content-accent-hover">
              Terms of Service
            </a>.
          </p>
        </section>

      </div>
    </div>
  );
}
