'use client';
import { useState } from 'react';
import { getContrastColor } from '../../lib/colorUtils';
import { formatTime } from '../../lib/dateUtils';
import { useTimezone } from '../components/TimezoneProvider';
import SafeImage from './SafeImage';
import QRCodeModal from './QRCodeModal';
import { eventsAPI } from '../../lib/api';

export default function EventDayModal({
  selectedDay,
  onClose,
  onEventClick,
}) {
  const { timezone } = useTimezone();
  const [showGameQR, setShowGameQR] = useState(false);
  const [gameInviteUrl, setGameInviteUrl] = useState('');
  const [gameQRLoading, setGameQRLoading] = useState(false);
  const [qrEventId, setQrEventId] = useState(null);

  if (!selectedDay) return null;

  const handleShowGameQR = async (e, event) => {
    e.stopPropagation(); // Prevent navigating to event detail
    setGameQRLoading(true);
    setQrEventId(event.id);
    try {
      const data = await eventsAPI.getEventInviteToken(event.id);
      setGameInviteUrl(data.invite_url);
      setShowGameQR(true);
    } catch (err) {
      console.error('Failed to get game invite token:', err);
    } finally {
      setGameQRLoading(false);
      setQrEventId(null);
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
    >
      <div
        className="modal-content max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="modal-header">
          <h3 className="text-xl font-bold text-content-primary">
            {selectedDay.date.toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              year: 'numeric'
            })}
          </h3>
          <button
            onClick={onClose}
            className="text-content-muted hover:text-content-primary text-2xl font-bold"
            title="Close"
          >
            ×
          </button>
        </div>

        {/* Modal Content */}
        <div className="modal-body">
          {selectedDay.events.length === 0 ? (
            <p className="text-content-secondary text-center py-8">No events on this day.</p>
          ) : (
            <div className="space-y-3">
              {selectedDay.events.map(event => {
                const eventDate = new Date(event.start_date);
                const isPastEvent = eventDate < new Date();
                const groupBgColor = event.Group?.background_color || '#ffffff';
                const groupProfilePic = event.Group?.profile_picture_url;
                const groupBgImage = event.Group?.background_image_url;

                return (
                  <div
                    key={event.id}
                    onClick={() => onEventClick(event)}
                    className={`p-4 border rounded-lg transition-all hover:shadow-md cursor-pointer`}
                    style={{
                      backgroundColor: groupBgColor,
                      backgroundImage: groupBgImage ? `url(${groupBgImage})` : 'none',
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      position: 'relative',
                      zIndex: 1,
                      borderColor: isPastEvent ? 'rgba(0,0,0,0.1)' : 'rgba(0,0,0,0.2)',
                    }}
                  >
                    <div style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: groupBgImage ? 'rgba(255, 255, 255, 0.85)' : 'transparent',
                      borderRadius: '0.5rem',
                    }} />
                    <div className="flex justify-between items-start relative z-10">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {groupProfilePic && (
                            <div className="w-10 h-10 rounded-full bg-surface-card flex items-center justify-center text-xl flex-shrink-0 overflow-hidden border-2 border-line shadow-sm">
                              {groupProfilePic.startsWith('http') || groupProfilePic.startsWith('/') ? (
                                <SafeImage
                                  src={groupProfilePic}
                                  alt={event.Group?.name}
                                  fallbackIcon="👥"
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <span>{groupProfilePic}</span>
                              )}
                            </div>
                          )}
                          <div>
                            <h4
                              className="font-semibold"
                              style={(() => {
                                const hasBgImage = !!groupBgImage;
                                const textColor = hasBgImage ? '#1f2937' : getContrastColor(groupBgColor);
                                const isDark = !hasBgImage && getContrastColor(groupBgColor) === '#ffffff';

                                return {
                                  color: textColor,
                                  textShadow: hasBgImage
                                    ? '1px 1px 2px rgba(255, 255, 255, 0.9)'
                                    : (isDark
                                      ? '2px 2px 4px rgba(0, 0, 0, 0.8), -1px -1px 2px rgba(0, 0, 0, 0.8)'
                                      : '1px 1px 2px rgba(255, 255, 255, 0.9)'),
                                  WebkitTextStroke: isDark ? '0.5px rgba(0, 0, 0, 0.9)' : 'none',
                                };
                              })()}
                            >
                              {event.Game?.name || 'Game Night'}
                            </h4>
                            <p
                              className="text-sm"
                              style={(() => {
                                const hasBgImage = !!groupBgImage;
                                const textColor = hasBgImage ? '#4b5563' : (getContrastColor(groupBgColor) === '#ffffff' ? 'rgba(255,255,255,0.9)' : '#6b7280');
                                const isDark = !hasBgImage && getContrastColor(groupBgColor) === '#ffffff';

                                return {
                                  color: textColor,
                                  textShadow: hasBgImage
                                    ? '1px 1px 2px rgba(255, 255, 255, 0.9)'
                                    : (isDark
                                      ? '1px 1px 3px rgba(0, 0, 0, 0.8)'
                                      : '1px 1px 2px rgba(255, 255, 255, 0.9)'),
                                  WebkitTextStroke: isDark ? '0.3px rgba(0, 0, 0, 0.9)' : 'none',
                                };
                              })()}
                            >
                              {event.Group?.name || 'Unknown Group'} - {formatTime(event.start_date, timezone)}
                            </p>
                          </div>
                          {!isPastEvent && (
                            <span className="px-2 py-0.5 bg-green-100 text-green-800 text-xs rounded ml-auto">
                              Upcoming
                            </span>
                          )}
                        </div>
                        <div className="flex gap-4 mt-2 text-sm text-content-muted">
                          {event.duration_minutes && (
                            <span>Duration: {event.duration_minutes} min</span>
                          )}
                        </div>
                        {/* Share Game QR button - visible for upcoming events */}
                        {!isPastEvent && (
                          <button
                            onClick={(e) => handleShowGameQR(e, event)}
                            disabled={gameQRLoading && qrEventId === event.id}
                            className="mt-2 btn btn-secondary text-xs px-3 py-1.5 inline-flex items-center gap-1.5"
                            title="Share Game QR"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75H16.5v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75H16.5v-.75z" />
                            </svg>
                            {gameQRLoading && qrEventId === event.id ? 'Loading...' : 'Share Game QR'}
                          </button>
                        )}
                      </div>
                      <SafeImage
                        src={event.Game?.image_url}
                        alt={event.Game?.name}
                        className="w-16 h-16 object-cover rounded"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Game QR Code Modal */}
      <QRCodeModal
        isOpen={showGameQR}
        onClose={() => setShowGameQR(false)}
        url={gameInviteUrl}
        title="Game Night Invite QR"
        showReset={false}
      />
    </div>
  );
}
