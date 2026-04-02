'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { groupsAPI, API_BASE_URL } from '../../lib/api';
import PromptScheduleReadOnly from './PromptScheduleReadOnly';
import SafeImage from './SafeImage';

// Default profile picture options
const DEFAULT_PROFILE_PICTURES = [
  { name: 'Dice', url: '🎲' },
  { name: 'Cards', url: '🃏' },
  { name: 'Trophy', url: '🏆' },
  { name: 'Game', url: '🎮' },
  { name: 'Puzzle', url: '🧩' },
  { name: 'Star', url: '⭐' },
  { name: 'Fire', url: '🔥' },
  { name: 'Rocket', url: '🚀' },
];

// Default background color options
const DEFAULT_BACKGROUND_COLORS = [
  { name: 'Charcoal', value: '#1e1e2e' },
  { name: 'Slate', value: '#1e293b' },
  { name: 'Navy', value: '#172554' },
  { name: 'Indigo', value: '#1e1b4b' },
  { name: 'Forest', value: '#14332a' },
  { name: 'Wine', value: '#3b1030' },
  { name: 'Espresso', value: '#2c1f14' },
  { name: 'Storm', value: '#27272a' },
];

export default function GroupSettings({ group, user, onClose, onUpdate, userRole, onGroupDeleted }) {
  const router = useRouter();
  const [profilePictureUrl, setProfilePictureUrl] = useState(group.profile_picture_url || '');
  const [backgroundColor, setBackgroundColor] = useState(group.background_color || '#ffffff');
  const [backgroundImageUrl, setBackgroundImageUrl] = useState(group.background_image_url || '');
  const [customPictureUrl, setCustomPictureUrl] = useState('');
  const [customBackgroundUrl, setCustomBackgroundUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleSave = async () => {
    if (!user?.sub) return;
    
    try {
      setSaving(true);
      const settings = {
        profile_picture_url: profilePictureUrl || null,
        background_color: backgroundColor,
        background_image_url: backgroundImageUrl || null,
      };
      
      await groupsAPI.updateGroupSettings(group.id, user.sub, settings);
      if (onUpdate) onUpdate();
      if (onClose) onClose();
    } catch (error) {
      console.error('Error updating group settings:', error);
      alert('Failed to update group settings. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleSelectDefaultPicture = (emoji) => {
    setProfilePictureUrl(emoji);
    setCustomPictureUrl('');
  };

  const handleSelectDefaultColor = (color) => {
    setBackgroundColor(color);
    setBackgroundImageUrl('');
    setCustomBackgroundUrl('');
  };

  const handleUseCustomPicture = () => {
    if (customPictureUrl.trim()) {
      setProfilePictureUrl(customPictureUrl.trim());
    }
  };

  const handleUseCustomBackground = () => {
    if (customBackgroundUrl.trim()) {
      setBackgroundImageUrl(customBackgroundUrl.trim());
      setBackgroundColor('#ffffff'); // Reset color when using image
    }
  };

  const handleDeleteGroup = async () => {
    if (!user?.sub || !group) return;
    
    // Triple check: user must type the exact group name
    if (deleteConfirmText !== group.name) {
      alert(`Please type the exact group name "${group.name}" to confirm deletion.`);
      return;
    }
    
    if (!confirm('This action cannot be undone. Are you absolutely sure you want to delete this group?')) {
      return;
    }
    
    try {
      setDeleting(true);
      await groupsAPI.deleteGroup(group.id, user.sub);
      
      // Close modal and navigate away
      if (onClose) onClose();
      if (onGroupDeleted) {
        onGroupDeleted();
      } else {
        // Navigate to home if no callback provided
        router.push('/');
      }
    } catch (error) {
      console.error('Error deleting group:', error);
      alert(error.message || 'Failed to delete group. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 100 }} onClick={onClose}>
      <div className="modal-content max-w-2xl w-full mx-4 p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-content-primary">Customize Group</h2>
          <button
            onClick={onClose}
            className="text-content-muted hover:text-content-primary text-2xl"
          >
            ×
          </button>
        </div>

        {/* Profile Picture Section */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-content-primary mb-3">Profile Picture</h3>
          
          {/* Current Selection Preview */}
          <div className="mb-4 p-4 border border-line rounded-lg bg-surface-page">
            <div className="text-center">
              <div className="inline-block w-20 h-20 rounded-full bg-surface-card-hover flex items-center justify-center text-4xl mb-2">
                {profilePictureUrl ? (
                  profilePictureUrl.startsWith('http') || profilePictureUrl.startsWith('/') ? (
                    <SafeImage
                      src={profilePictureUrl}
                      alt="Profile"
                      fallbackIcon="👥"
                      className="w-20 h-20 rounded-full object-cover"
                    />
                  ) : (
                    <span>{profilePictureUrl}</span>
                  )
                ) : (
                  <span className="text-content-muted">No picture</span>
                )}
              </div>
              <p className="text-sm text-content-secondary">Current selection</p>
            </div>
          </div>

          {/* Default Options */}
          <div className="mb-4">
            <p className="text-sm text-content-secondary mb-2">Choose a default icon:</p>
            <div className="grid grid-cols-4 gap-2">
              {DEFAULT_PROFILE_PICTURES.map((pic, index) => (
                <button
                  key={index}
                  onClick={() => handleSelectDefaultPicture(pic.url)}
                  className={`p-4 border-2 rounded-lg text-3xl hover:bg-surface-card-hover transition-colors ${
                    profilePictureUrl === pic.url ? 'border-accent bg-surface-card-hover' : 'border-line'
                  }`}
                  title={pic.name}
                >
                  {pic.url}
                </button>
              ))}
            </div>
          </div>

          {/* Custom URL */}
          <div>
            <p className="text-sm text-content-secondary mb-2">Or enter a custom image URL:</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={customPictureUrl}
                onChange={(e) => setCustomPictureUrl(e.target.value)}
                placeholder="https://example.com/image.jpg"
                className="flex-1 p-2 border border-line rounded text-content-primary bg-surface-input"
              />
              <button
                onClick={handleUseCustomPicture}
                className="btn btn-primary"
              >
                Use
              </button>
            </div>
          </div>
        </div>

        {/* Background Section */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-content-primary mb-3">Background</h3>
          
          {/* Current Selection Preview */}
          <div className="mb-4 p-4 border rounded-lg" style={{ 
            backgroundColor: backgroundColor,
            backgroundImage: backgroundImageUrl ? `url(${backgroundImageUrl})` : 'none',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            minHeight: '100px'
          }}>
            <p className="text-sm text-content-secondary text-center">Preview</p>
          </div>

          {/* Default Colors */}
          <div className="mb-4">
            <p className="text-sm text-content-secondary mb-2">Choose a default color:</p>
            <div className="grid grid-cols-4 gap-2">
              {DEFAULT_BACKGROUND_COLORS.map((color, index) => (
                <button
                  key={index}
                  onClick={() => handleSelectDefaultColor(color.value)}
                  className={`p-4 border-2 rounded-lg hover:opacity-80 transition-opacity ${
                    backgroundColor === color.value && !backgroundImageUrl ? 'border-accent ring-2 ring-focus-ring' : 'border-line'
                  }`}
                  style={{ backgroundColor: color.value }}
                  title={color.name}
                />
              ))}
            </div>
          </div>

          {/* Custom Background URL */}
          <div>
            <p className="text-sm text-content-secondary mb-2">Or enter a custom background image URL:</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={customBackgroundUrl}
                onChange={(e) => setCustomBackgroundUrl(e.target.value)}
                placeholder="https://example.com/background.jpg"
                className="flex-1 p-2 border border-line rounded text-content-primary bg-surface-input"
              />
              <button
                onClick={handleUseCustomBackground}
                className="btn btn-primary"
              >
                Use
              </button>
            </div>
          </div>
        </div>

        {/* Prompt Schedules Section (read-only) */}
        <div className="mb-6 pt-6 border-t border-line">
          <PromptScheduleReadOnly
            groupId={group.id}
            groupPageUrl={`/groupHomePage?id=${group.id}`}
          />
        </div>

        {/* Delete Group Section - Owner Only */}
        {userRole === 'owner' && (
          <div className="mb-6 pt-6 border-t border-red-200">
            <h3 className="text-lg font-semibold text-red-600 mb-3">Danger Zone</h3>
            <p className="text-sm text-content-secondary mb-4">
              Deleting a group will permanently remove all events, members, and reviews associated with it. This action cannot be undone.
            </p>
            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="btn btn-danger"
              >
                Delete Group
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-medium text-content-secondary">
                  To confirm deletion, please type the group name: <span className="font-bold text-content-primary">{group.name}</span>
                </p>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="Type group name to confirm"
                  className="w-full p-2 border border-red-300 rounded text-content-primary bg-surface-input focus:outline-none focus:ring-2 focus:ring-red-500"
                />
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setShowDeleteConfirm(false);
                      setDeleteConfirmText('');
                    }}
                    className="btn btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteGroup}
                    disabled={deleting || deleteConfirmText !== group.name}
                    className="btn btn-danger"
                  >
                    {deleting ? 'Deleting...' : 'Delete Group'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="btn btn-secondary"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

    </div>
  );
}

