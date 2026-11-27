'use client';

import Link from 'next/link';

/**
 * "Powered by BGG" Logo Component
 * 
 * Required by BoardGameGeek XML API Terms of Use for public-facing applications.
 * See: https://boardgamegeek.com/using_the_xml_api
 * 
 * Logo files available at:
 * https://drive.google.com/drive/folders/1k3VgEIpNEY59iTVnpTibt31JcO0rEaSw?usp=drive_link
 * 
 * TODO: Replace placeholder with actual BGG logo image once downloaded
 */
export default function BGGLogo() {
  return (
    // DECISION Phase 88.9-52 (W20): in dark the mark sits on a white plate, chosen OVER inverting or
    // recolouring the image (it is BoardGameGeek's own brand mark, not ours to repaint) and OVER
    // leaving it on the dark page (the navy wordmark read 1.59 there; 10.63 on the plate). The plate's padding is on in both themes so the theme switch moves nothing; the
    // wrapper gave up 4px a side to it, so the footer keeps its height. Light paints no plate.
    // AMENDED Phase 89.6-43 (bgg-floor): the link itself is now at least 44px tall (the house floor; it
    // was 32), so in dark the plate is 44px tall at ordinary text; the wrapper's 4px a side is retired
    // (a phone footer is 4px taller; from md the 44px links already set the row height). It also
    // wears the house ring (it rode the browser outline).
    // DECISION Phase 89.6-43 (bgg-floor): a 44px CSS-px minimum on the link, chosen OVER min-h-11 (an
    // 88px white plate at doubled text, more than the floor needs) and OVER rem padding (it doubles
    // with text the same way); the mark stays 24px and is never recoloured. Changing this is a
    // decision, not a cleanup.
    <div className="flex shrink-0 items-center justify-center">
      <Link 
        href="https://boardgamegeek.com" 
        target="_blank" 
        rel="noopener noreferrer"
        className="flex shrink-0 items-center gap-2 min-h-[44px] rounded-sm px-2 py-1 dark:bg-white hover:opacity-80 transition-opacity focus:outline-hidden focus-visible:focus-ring"
        aria-label="Powered by BoardGameGeek"
      >
        <img 
          src="/bgg-logo.png" 
          alt="Powered by BoardGameGeek" 
          className="h-6 w-auto"
          style={{ minHeight: '24px' }}
        />
      </Link>
    </div>
  );
}


