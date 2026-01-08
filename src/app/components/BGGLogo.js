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
    <div className="flex items-center justify-center py-2">
      <Link 
        href="https://boardgamegeek.com" 
        target="_blank" 
        rel="noopener noreferrer"
        className="flex items-center gap-2 hover:opacity-80 transition-opacity"
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


