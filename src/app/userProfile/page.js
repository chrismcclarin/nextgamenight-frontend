'use client';

import { useState, useEffect, useCallback } from 'react';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { useSearchParams } from 'next/navigation';
import { userGamesAPI, gamesAPI, googleCalendarAPI, usersAPI, availabilityAPI } from '../../lib/api';
import { parsePhoneNumber } from 'libphonenumber-js';
import Link from 'next/link';
import { formatDate } from '../../lib/dateUtils';
import SafeImage from '../components/SafeImage';
import { useTutorial } from '../components/tutorial/TutorialProvider';
import { useTimezone } from '../components/TimezoneProvider';

const NOTIFICATION_TYPES = [
    { key: 'event_created', label: 'New Event', description: 'When a game session is scheduled' },
    { key: 'reminder', label: 'Event Reminders', description: 'Before upcoming events' },
    { key: 'event_updated', label: 'Event Updates', description: 'When event details change' },
    { key: 'event_cancelled', label: 'Event Cancelled', description: 'When an event is cancelled' },
];

const REMINDER_WINDOWS = [
    { value: 0.5, label: '30 minutes before' },
    { value: 1, label: '1 hour before' },
    { value: 2, label: '2 hours before' },
    { value: 24, label: '1 day before' },
];

const DEFAULT_PREFERENCES = {
    event_created: { email: true, sms: false },
    reminder: { email: true, sms: false, window_hours: 1 },
    event_updated: { email: true, sms: false },
    event_cancelled: { email: true, sms: false },
};

function Profile(){
    const { user, error, isLoading } = Auth();
    const searchParams = useSearchParams();
    const [ownedGames, setOwnedGames] = useState([]);
    const [loadingGames, setLoadingGames] = useState(true);
    const [bggSearchQuery, setBggSearchQuery] = useState('');
    const [bggSearchResults, setBggSearchResults] = useState([]);
    const [bggSearching, setBggSearching] = useState(false);
    const [showBggSearch, setShowBggSearch] = useState(false);
    const [bggUsername, setBggUsername] = useState('');
    const [importingCollection, setImportingCollection] = useState(false);
    const [importProgress, setImportProgress] = useState(null);
    const [googleCalendarConnected, setGoogleCalendarConnected] = useState(false);
    const [checkingCalendarStatus, setCheckingCalendarStatus] = useState(true);
    const [userData, setUserData] = useState(null);
    const [editingUsername, setEditingUsername] = useState(false);
    const [username, setUsername] = useState('');
    const [savingUsername, setSavingUsername] = useState(false);
    
    // Availability settings state
    const [availabilityTab, setAvailabilityTab] = useState('recurring'); // 'recurring' or 'specific'
    const [availabilityPatterns, setAvailabilityPatterns] = useState([]);
    const [loadingPatterns, setLoadingPatterns] = useState(true);
    const [showRecurringForm, setShowRecurringForm] = useState(false);
    const [showSpecificForm, setShowSpecificForm] = useState(false);
    const [recurringForm, setRecurringForm] = useState({
        daysOfWeek: [],
        startTime: '09:00',
        endTime: '17:00',
        start_date: new Date().toISOString().split('T')[0],
        end_date: '',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    });
    const [specificForm, setSpecificForm] = useState({
        date: new Date().toISOString().split('T')[0],
        startTime: '09:00',
        endTime: '17:00',
        isAvailable: true,
    });
    const [savingPattern, setSavingPattern] = useState(false);
    const [replayingTutorial, setReplayingTutorial] = useState(false);

    // Phone verification state machine: idle | editing | saving | verifying | verified
    const [phoneState, setPhoneState] = useState('idle');
    const [phoneInput, setPhoneInput] = useState('');
    const [phoneValidation, setPhoneValidation] = useState({ valid: false, error: null });
    const [verificationCode, setVerificationCode] = useState('');
    const [phoneError, setPhoneError] = useState(null);
    const [resendCooldown, setResendCooldown] = useState(0);

    // Notification preferences state
    const [preferences, setPreferences] = useState(null);
    const [saveStatus, setSaveStatus] = useState(null); // { type, channel, status: 'saving'|'saved'|'error'|'guard' }

    const { replayTutorial } = useTutorial();
    const { timezone, setTimezone } = useTimezone();

    // Timezone picker state
    const [tzPickerOpen, setTzPickerOpen] = useState(false);
    const [tzSearch, setTzSearch] = useState('');

    // Get all IANA timezones with UTC offset info
    const getTimezoneList = useCallback(() => {
        try {
            const zones = Intl.supportedValuesOf('timeZone');
            return zones.map(tz => {
                try {
                    const formatter = new Intl.DateTimeFormat('en-US', {
                        timeZone: tz,
                        timeZoneName: 'short',
                    });
                    const parts = formatter.formatToParts(new Date());
                    const abbr = parts.find(p => p.type === 'timeZoneName')?.value || '';

                    const offsetFormatter = new Intl.DateTimeFormat('en-US', {
                        timeZone: tz,
                        timeZoneName: 'longOffset',
                    });
                    const offsetParts = offsetFormatter.formatToParts(new Date());
                    const offset = offsetParts.find(p => p.type === 'timeZoneName')?.value || '';

                    return { value: tz, abbr, offset, label: `${tz} (${abbr}, ${offset})` };
                } catch {
                    return { value: tz, abbr: '', offset: '', label: tz };
                }
            });
        } catch {
            // Fallback for older browsers that don't support supportedValuesOf
            return [{ value: timezone || 'UTC', abbr: '', offset: '', label: timezone || 'UTC' }];
        }
    }, [timezone]);

    const filteredTimezones = useCallback(() => {
        const all = getTimezoneList();
        if (!tzSearch.trim()) return all;
        const query = tzSearch.toLowerCase().replace(/[_/]/g, ' ');
        return all.filter(tz => {
            const searchable = tz.label.toLowerCase().replace(/[_/]/g, ' ');
            return searchable.includes(query);
        });
    }, [getTimezoneList, tzSearch]);

    // Group timezones by region prefix
    const groupedTimezones = useCallback(() => {
        const zones = filteredTimezones();
        const groups = {};
        zones.forEach(tz => {
            const slashIndex = tz.value.indexOf('/');
            const region = slashIndex > -1 ? tz.value.substring(0, slashIndex) : 'Other';
            if (!groups[region]) groups[region] = [];
            groups[region].push(tz);
        });
        return groups;
    }, [filteredTimezones]);

    const handleTimezoneSelect = (tz) => {
        setTimezone(tz);
        setTzPickerOpen(false);
        setTzSearch('');
    };

    // Get current timezone abbreviation for display
    const currentTzAbbr = useCallback(() => {
        try {
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: timezone,
                timeZoneName: 'short',
            });
            const parts = formatter.formatToParts(new Date());
            return parts.find(p => p.type === 'timeZoneName')?.value || '';
        } catch {
            return '';
        }
    }, [timezone]);

    const handleReplayTutorial = async () => {
        if (!user?.sub) return;
        try {
            setReplayingTutorial(true);
            await usersAPI.resetTutorial(user.sub);
            replayTutorial();
        } catch (error) {
            console.error('Error replaying tutorial:', error);
            alert('Failed to replay tutorial. Please try again.');
        } finally {
            setReplayingTutorial(false);
        }
    };

    // Phone validation
    const validatePhoneInput = (value) => {
        if (!value) return { valid: false, error: null };
        try {
            const phoneNumber = parsePhoneNumber(value, 'US');
            if (phoneNumber && phoneNumber.isValid()) {
                return { valid: true, formatted: phoneNumber.formatInternational() };
            }
            return { valid: false, error: 'Invalid phone number' };
        } catch {
            return { valid: false, error: value.length > 5 ? 'Invalid phone number' : null };
        }
    };

    const handlePhoneChange = (value) => {
        setPhoneInput(value);
        setPhoneValidation(validatePhoneInput(value));
        setPhoneError(null);
        if (phoneState === 'idle' || phoneState === 'verified') {
            setPhoneState('editing');
        }
    };

    const handleSaveAndVerify = async () => {
        if (!user?.sub || !phoneValidation.valid) return;
        try {
            setPhoneState('saving');
            setPhoneError(null);
            await usersAPI.savePhone(user.sub, phoneInput);
            setPhoneState('verifying');
        } catch (error) {
            console.error('Error saving phone:', error);
            setPhoneError(error.message || 'Failed to send verification code');
            setPhoneState('editing');
        }
    };

    const handleVerifyCode = async () => {
        if (!user?.sub || !verificationCode) return;
        try {
            setPhoneError(null);
            await usersAPI.verifyPhone(user.sub, verificationCode);
            setPhoneState('verified');
            setVerificationCode('');
            // Refetch user data to get updated phone_verified
            await fetchUserData();
        } catch (error) {
            console.error('Error verifying code:', error);
            setPhoneError(error.message || 'Invalid verification code');
        }
    };

    const handleChangeNumber = () => {
        setPhoneState('editing');
        setVerificationCode('');
        setPhoneError(null);
    };

    const handleResendCode = async () => {
        if (!user?.sub || resendCooldown > 0) return;
        try {
            setPhoneError(null);
            await usersAPI.savePhone(user.sub, phoneInput);
            setResendCooldown(60);
            const timer = setInterval(() => {
                setResendCooldown(prev => {
                    if (prev <= 1) {
                        clearInterval(timer);
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        } catch (error) {
            console.error('Error resending code:', error);
            setPhoneError(error.message || 'Failed to resend code');
        }
    };

    // Notification preference toggle handler (auto-save with optimistic update)
    const handleToggle = async (notificationType, channel, newValue) => {
        // Guard: at least one channel must be enabled globally across all notification types
        if (!newValue) {
            const testPrefs = {
                ...preferences,
                [notificationType]: { ...preferences[notificationType], [channel]: false }
            };
            const anyEnabled = NOTIFICATION_TYPES.some(t =>
                testPrefs[t.key]?.email || testPrefs[t.key]?.sms
            );
            if (!anyEnabled) {
                setSaveStatus({ type: notificationType, channel, status: 'guard' });
                setTimeout(() => setSaveStatus(null), 3000);
                return;
            }
        }

        // Optimistic update
        const previousPrefs = { ...preferences };
        const updatedPrefs = {
            ...preferences,
            [notificationType]: { ...preferences[notificationType], [channel]: newValue }
        };
        setPreferences(updatedPrefs);
        setSaveStatus({ type: notificationType, channel, status: 'saving' });

        try {
            await usersAPI.updateNotificationPreferences(user.sub, updatedPrefs);
            setSaveStatus({ type: notificationType, channel, status: 'saved' });
            setTimeout(() => setSaveStatus(null), 2000);
        } catch (error) {
            console.error('Error updating preference:', error);
            setPreferences(previousPrefs);
            setSaveStatus({ type: notificationType, channel, status: 'error' });
            setTimeout(() => setSaveStatus(null), 3000);
        }
    };

    // Reminder timing handler
    const handleReminderWindowChange = async (newWindowHours) => {
        const previousPrefs = { ...preferences };
        const updatedPrefs = {
            ...preferences,
            reminder: { ...preferences.reminder, window_hours: newWindowHours }
        };
        setPreferences(updatedPrefs);
        setSaveStatus({ type: 'reminder', channel: 'window', status: 'saving' });

        try {
            await usersAPI.updateNotificationPreferences(user.sub, updatedPrefs);
            setSaveStatus({ type: 'reminder', channel: 'window', status: 'saved' });
            setTimeout(() => setSaveStatus(null), 2000);
        } catch (error) {
            console.error('Error updating reminder window:', error);
            setPreferences(previousPrefs);
            setSaveStatus({ type: 'reminder', channel: 'window', status: 'error' });
            setTimeout(() => setSaveStatus(null), 3000);
        }
    };

    // Reset to defaults handler
    const handleResetPreferences = async () => {
        const previousPrefs = { ...preferences };
        setPreferences(DEFAULT_PREFERENCES);
        setSaveStatus({ type: 'all', channel: 'reset', status: 'saving' });

        try {
            await usersAPI.updateNotificationPreferences(user.sub, DEFAULT_PREFERENCES);
            setSaveStatus({ type: 'all', channel: 'reset', status: 'saved' });
            setTimeout(() => setSaveStatus(null), 2000);
        } catch (error) {
            console.error('Error resetting preferences:', error);
            setPreferences(previousPrefs);
            setSaveStatus({ type: 'all', channel: 'reset', status: 'error' });
            setTimeout(() => setSaveStatus(null), 3000);
        }
    };

    const fetchUserData = useCallback(async () => {
        if (!user?.sub) return;
        try {
            const userInfo = await usersAPI.getUser(user.sub);
            setUserData(userInfo);
            setUsername(userInfo.username || user.name || user.email?.split('@')[0] || '');
            // Initialize phone state
            if (userInfo.phone && userInfo.phone_verified) {
                setPhoneState('verified');
                setPhoneInput(userInfo.phone);
            } else if (userInfo.phone) {
                setPhoneState('idle');
                setPhoneInput(userInfo.phone);
            }
            // Initialize notification preferences
            setPreferences(userInfo.notification_preferences || DEFAULT_PREFERENCES);
        } catch (error) {
            console.error('Error fetching user data:', error);
            // Fallback to Auth0 user data
            setUsername(user.name || user.email?.split('@')[0] || 'User');
            setPreferences(DEFAULT_PREFERENCES);
        }
    }, [user]);
    
    const handleSaveUsername = async () => {
        if (!user?.sub || !username.trim()) {
            alert('Please enter a username');
            return;
        }
        
        if (username.length > 50) {
            alert('Username must be 50 characters or less');
            return;
        }
        
        try {
            setSavingUsername(true);
            const updatedUser = await usersAPI.updateUsername(user.sub, username.trim());
            setUserData(updatedUser);
            setEditingUsername(false);
            alert('Username updated successfully!');
        } catch (error) {
            console.error('Error updating username:', error);
            alert(`Failed to update username: ${error.message || 'Please try again.'}`);
        } finally {
            setSavingUsername(false);
        }
    };

    const checkGoogleCalendarStatus = useCallback(async () => {
        if (!user?.sub) return;
        try {
            setCheckingCalendarStatus(true);
            const status = await googleCalendarAPI.getStatus(user.sub);
            setGoogleCalendarConnected(status.connected || false);
        } catch (error) {
            console.error('Error checking Google Calendar status:', error.message);
            setGoogleCalendarConnected(false);
        } finally {
            setCheckingCalendarStatus(false);
        }
    }, [user]);

    // Check for Google Calendar connection status from URL params (after OAuth redirect)
    // This must come AFTER checkGoogleCalendarStatus is defined
    useEffect(() => {
        if (!searchParams || !user?.sub) return;
        const calendarStatus = searchParams.get('google_calendar');
        if (calendarStatus === 'connected') {
            // Refresh status from backend to verify connection
            checkGoogleCalendarStatus();
            // Remove query param from URL
            window.history.replaceState({}, '', '/userProfile/');
        } else if (calendarStatus === 'error') {
            const errorMessage = searchParams.get('message');
            alert(`Failed to connect Google Calendar: ${errorMessage || 'Unknown error'}`);
            setGoogleCalendarConnected(false);
            window.history.replaceState({}, '', '/userProfile/');
        }
    }, [searchParams, user, checkGoogleCalendarStatus]);

    const handleConnectGoogleCalendar = () => {
        if (!user?.sub) return;
        // Redirect to Next.js API route that handles authentication and redirects to Google OAuth
        window.location.href = '/api/auth/google-connect';
    };

    const handleDisconnectGoogleCalendar = async () => {
        if (!user?.sub) return;
        if (!confirm('Are you sure you want to disconnect Google Calendar? Future events will not be automatically added to your calendar.')) {
            return;
        }
        try {
            await googleCalendarAPI.disconnect(user.sub);
            setGoogleCalendarConnected(false);
            alert('Google Calendar disconnected successfully');
        } catch (error) {
            console.error('Error disconnecting Google Calendar:', error);
            alert('Failed to disconnect Google Calendar. Please try again.');
        }
    };

    const fetchOwnedGames = useCallback(async () => {
        if (!user?.sub) return;
        try {
            setLoadingGames(true);
            const games = await userGamesAPI.getOwnedGames(user.sub);
            setOwnedGames(games || []);
        } catch (error) {
            console.error('Error fetching owned games:', error);
            setOwnedGames([]);
        } finally {
            setLoadingGames(false);
        }
    }, [user]);

    const searchBGG = async () => {
        if (!bggSearchQuery.trim()) return;
        try {
            setBggSearching(true);
            const results = await gamesAPI.searchBGG(bggSearchQuery);
            setBggSearchResults(results || []);
            if (results.length === 0) {
                alert('No games found. Try a different search term.');
            }
        } catch (error) {
            console.error('Error searching BGG:', error);
            setBggSearchResults([]);
            const errorMessage = error.message || 'Failed to search BoardGameGeek';
            if (errorMessage.includes('401') || errorMessage.includes('403') || errorMessage.includes('rate limiting')) {
                alert('BoardGameGeek API is currently unavailable or rate-limited. Please try again in a few moments.');
            } else {
                alert(`Error searching BoardGameGeek: ${errorMessage}`);
            }
        } finally {
            setBggSearching(false);
        }
    };

    const addGameToCollection = async (game_id) => {
        if (!user?.sub) return;
        try {
            // If game_id is a BGG ID, import it first
            let gameId = game_id;
            if (typeof game_id === 'number' || (typeof game_id === 'string' && !game_id.includes('-'))) {
                // It's a BGG ID, import it first
                const importedGame = await gamesAPI.importFromBGG(game_id);
                gameId = importedGame.id;
            }
            
            await userGamesAPI.addOwnedGame(user.sub, gameId);
            await fetchOwnedGames();
            setShowBggSearch(false);
            setBggSearchQuery('');
            setBggSearchResults([]);
        } catch (error) {
            console.error('Error adding game to collection:', error);
            alert('Failed to add game to collection. Please try again.');
        }
    };

    const removeGameFromCollection = async (game_id) => {
        if (!user?.sub) return;
        if (!confirm('Are you sure you want to remove this game from your collection?')) return;
        try {
            await userGamesAPI.removeOwnedGame(user.sub, game_id);
            await fetchOwnedGames();
        } catch (error) {
            console.error('Error removing game from collection:', error);
            alert('Failed to remove game from collection. Please try again.');
        }
    };

    const fetchAvailabilityPatterns = useCallback(async () => {
        if (!user?.sub) return;
        try {
            setLoadingPatterns(true);
            const patterns = await availabilityAPI.getUserPatterns(user.sub);
            setAvailabilityPatterns(patterns || []);
        } catch (error) {
            console.error('Error fetching availability patterns:', error);
            setAvailabilityPatterns([]);
        } finally {
            setLoadingPatterns(false);
        }
    }, [user]);

    useEffect(() => {
        if (user?.sub) {
            fetchUserData();
            fetchOwnedGames();
            checkGoogleCalendarStatus();
            fetchAvailabilityPatterns();
        }
    }, [user, fetchUserData, fetchOwnedGames, checkGoogleCalendarStatus, fetchAvailabilityPatterns]);

    const handleCreateRecurringPattern = async () => {
        if (!user?.sub) return;
        if (recurringForm.daysOfWeek.length === 0) {
            alert('Please select at least one day.');
            return;
        }
        try {
            setSavingPattern(true);
            // Create one schedule per selected day
            for (const dayOfWeek of recurringForm.daysOfWeek) {
                const formData = { ...recurringForm, dayOfWeek };
                delete formData.daysOfWeek;
                if (!formData.end_date || formData.end_date.trim() === '') {
                    delete formData.end_date;
                }
                await availabilityAPI.createRecurringPattern(user.sub, formData);
            }
            await fetchAvailabilityPatterns();
            setShowRecurringForm(false);
            setRecurringForm({
                daysOfWeek: [],
                startTime: '09:00',
                endTime: '17:00',
                start_date: new Date().toISOString().split('T')[0],
                end_date: '',
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
            });
            const count = recurringForm.daysOfWeek.length;
            alert(`${count} schedule${count > 1 ? 's' : ''} created successfully!`);
        } catch (error) {
            console.error('Error creating schedule:', error);
            alert(`Failed to create pattern: ${error.message || 'Please try again.'}`);
        } finally {
            setSavingPattern(false);
        }
    };

    const handleCreateSpecificOverride = async () => {
        if (!user?.sub) return;
        try {
            setSavingPattern(true);
            await availabilityAPI.createOverride(user.sub, specificForm);
            await fetchAvailabilityPatterns();
            setShowSpecificForm(false);
            setSpecificForm({
                date: new Date().toISOString().split('T')[0],
                startTime: '09:00',
                endTime: '17:00',
                isAvailable: true,
            });
            alert('Specific override created successfully!');
        } catch (error) {
            console.error('Error creating specific override:', error);
            alert(`Failed to create override: ${error.message || 'Please try again.'}`);
        } finally {
            setSavingPattern(false);
        }
    };

    const handleDeletePattern = async (patternId) => {
        if (!confirm('Are you sure you want to delete this availability pattern?')) return;
        try {
            await availabilityAPI.deleteAvailability(patternId);
            await fetchAvailabilityPatterns();
            alert('Pattern deleted successfully!');
        } catch (error) {
            console.error('Error deleting pattern:', error);
            alert('Failed to delete pattern. Please try again.');
        }
    };

    const getDayName = (dayOfWeek) => {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return days[dayOfWeek];
    };


    const importBGGCollection = async () => {
        if (!user?.sub || !bggUsername.trim()) {
            alert('Please enter your BGG username');
            return;
        }
        
        if (!confirm(`This will import all games from your BoardGameGeek collection (username: ${bggUsername}). This may take a few minutes. Continue?`)) {
            return;
        }

        try {
            setImportingCollection(true);
            setImportProgress({ status: 'fetching', message: 'Fetching your BGG collection...' });
            
            const result = await userGamesAPI.importBGGCollection(user.sub, bggUsername.trim());
            
            setImportProgress({
                status: 'complete',
                message: `Successfully imported ${result.imported} games!`,
                details: result
            });
            
            // Refresh the owned games list
            await fetchOwnedGames();
            
            // Clear the username after successful import
            setTimeout(() => {
                setBggUsername('');
                setImportProgress(null);
            }, 5000);
        } catch (error) {
            console.error('Error importing BGG collection:', error);
            setImportProgress({
                status: 'error',
                message: error.message || 'Failed to import BGG collection. Please try again.'
            });
        } finally {
            setImportingCollection(false);
        }
    };

    if (isLoading) return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
    if (error) return <div className="flex items-center justify-center min-h-screen text-red-500">{error.message}</div>;

    return (
        user && (
            <div className="p-3 md:p-6 max-w-4xl mx-auto">
                {/* Breadcrumbs */}
                <nav className="mb-4 text-sm bg-gray-800 px-3 py-2 rounded-lg inline-block">
                    <Link href="/" className="text-blue-400 hover:text-blue-300 transition-colors font-medium">Home</Link>
                    <span className="text-gray-400 mx-2">{'>'}</span>
                    <span className="text-white font-semibold">Profile</span>
                </nav>

                {/* Profile Header */}
                <div className="bg-white rounded-lg shadow-md p-4 md:p-6 mb-6">
                    <div className="flex items-center gap-3 md:gap-4">
                        {user.picture && (
                            <img src={user.picture} alt={userData?.username || user.name} className="w-16 h-16 md:w-20 md:h-20 rounded-full flex-shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                            {editingUsername ? (
                                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                                    <input
                                        type="text"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        maxLength={50}
                                        className="flex-1 px-3 py-2 border rounded text-gray-900 bg-white text-lg md:text-xl font-bold"
                                        placeholder="Enter username"
                                        autoFocus
                                    />
                                    <div className="flex gap-2">
                                        <button
                                            onClick={handleSaveUsername}
                                            disabled={savingUsername || !username.trim()}
                                            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400 text-sm whitespace-nowrap"
                                        >
                                            {savingUsername ? 'Saving...' : 'Save'}
                                        </button>
                                        <button
                                            onClick={() => {
                                                setEditingUsername(false);
                                                setUsername(userData?.username || user.name || user.email?.split('@')[0] || '');
                                            }}
                                            disabled={savingUsername}
                                            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 disabled:bg-gray-400 text-sm whitespace-nowrap"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                    <p className="text-xs text-gray-500">{username.length}/50</p>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <h1 className="text-xl md:text-2xl font-bold text-gray-900 truncate">
                                        {userData?.username || user.name}
                                    </h1>
                                    <button
                                        onClick={() => setEditingUsername(true)}
                                        className="text-blue-600 hover:text-blue-700 text-sm md:text-base"
                                        title="Edit username"
                                    >
                                        ✏️
                                    </button>
                                </div>
                            )}
                            <p className="text-sm md:text-base text-gray-600 truncate">{user.email}</p>
                            {userData?.username && userData.username !== user.name && (
                                <p className="text-xs text-gray-500 mt-1">
                                    Display name: {userData.username} (from Google: {user.name})
                                </p>
                            )}

                            {/* Phone Input - only when sms_enabled */}
                            {userData?.sms_enabled && (
                                <div className="mt-2">
                                    {(phoneState === 'idle' || phoneState === 'editing') && (
                                        <div className="flex flex-col sm:flex-row sm:items-start gap-2">
                                            <div className="flex-1 relative">
                                                <input
                                                    type="tel"
                                                    value={phoneInput}
                                                    onChange={(e) => handlePhoneChange(e.target.value)}
                                                    placeholder="+1 555-123-4567"
                                                    className={`w-full px-3 py-2 border rounded-lg text-sm ${
                                                        phoneValidation.valid ? 'border-green-500' :
                                                        phoneValidation.error ? 'border-red-500' :
                                                        'border-gray-300'
                                                    }`}
                                                />
                                                {phoneValidation.valid && (
                                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-green-600">
                                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                        </svg>
                                                    </span>
                                                )}
                                                {phoneValidation.error && (
                                                    <p className="text-red-500 text-xs mt-1">{phoneValidation.error}</p>
                                                )}
                                            </div>
                                            <button
                                                onClick={handleSaveAndVerify}
                                                disabled={!phoneValidation.valid}
                                                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                                            >
                                                Save & Verify
                                            </button>
                                        </div>
                                    )}

                                    {phoneState === 'saving' && (
                                        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                                            <input
                                                type="tel"
                                                value={phoneInput}
                                                disabled
                                                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50"
                                            />
                                            <button
                                                disabled
                                                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm opacity-50 cursor-not-allowed whitespace-nowrap"
                                            >
                                                Sending code...
                                            </button>
                                        </div>
                                    )}

                                    {phoneState === 'verifying' && (
                                        <div>
                                            <p className="text-sm text-gray-700 mb-2">
                                                Code sent to <span className="font-medium">{phoneValidation.formatted || phoneInput}</span>
                                            </p>
                                            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                                                <input
                                                    type="text"
                                                    value={verificationCode}
                                                    onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                                    placeholder="Enter 6-digit code"
                                                    maxLength={6}
                                                    className="w-32 px-3 py-2 border rounded-lg text-sm text-center tracking-widest"
                                                />
                                                <button
                                                    onClick={handleVerifyCode}
                                                    disabled={verificationCode.length !== 6}
                                                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                                                >
                                                    Verify
                                                </button>
                                                <button
                                                    onClick={handleResendCode}
                                                    disabled={resendCooldown > 0}
                                                    className="text-sm text-indigo-600 hover:text-indigo-700 disabled:text-gray-400 whitespace-nowrap"
                                                >
                                                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                                                </button>
                                            </div>
                                            <button
                                                onClick={handleChangeNumber}
                                                className="text-sm text-gray-500 hover:text-gray-700 mt-1"
                                            >
                                                Change number
                                            </button>
                                        </div>
                                    )}

                                    {phoneState === 'verified' && (
                                        <div className="flex items-center gap-2">
                                            <span className="text-green-600">
                                                <svg className="w-5 h-5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                </svg>
                                            </span>
                                            <span className="text-sm text-green-700 font-medium">Phone verified</span>
                                            <button
                                                onClick={handleChangeNumber}
                                                className="text-sm text-gray-500 hover:text-gray-700 underline ml-2"
                                            >
                                                Change number
                                            </button>
                                        </div>
                                    )}

                                    {phoneError && (
                                        <p className="text-red-500 text-xs mt-1">{phoneError}</p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Google Calendar Connection */}
                    <div className="mt-4 pt-4 border-t border-gray-200">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div>
                                <h3 className="text-sm font-semibold text-gray-900 mb-1">Google Calendar Integration</h3>
                                <p className="text-xs text-gray-600">
                                    {googleCalendarConnected 
                                        ? 'Connected - Future game events will be automatically added to your calendar'
                                        : 'Connect your Google Calendar to automatically add future game events'}
                                </p>
                            </div>
                            {checkingCalendarStatus ? (
                                <div className="text-sm text-gray-500">Checking...</div>
                            ) : googleCalendarConnected ? (
                                <button
                                    onClick={handleDisconnectGoogleCalendar}
                                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm whitespace-nowrap"
                                >
                                    Disconnect Calendar
                                </button>
                            ) : (
                                <button
                                    onClick={handleConnectGoogleCalendar}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm whitespace-nowrap flex items-center gap-2"
                                >
                                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                                    </svg>
                                    Connect Google Calendar
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Timezone Setting */}
                <div className="bg-white rounded-lg shadow-md p-4 md:p-6 mb-6">
                    <h2 className="text-lg font-bold text-gray-900 mb-1">Timezone</h2>
                    <p className="text-sm text-gray-600 mb-3">All event times and schedules use this timezone</p>
                    <div className="relative">
                        <button
                            onClick={() => setTzPickerOpen(!tzPickerOpen)}
                            className="w-full flex items-center justify-between px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white hover:border-blue-400 transition-colors"
                        >
                            <span>
                                {timezone ? timezone.replace(/_/g, ' ') : 'Select timezone'}
                                {currentTzAbbr() && <span className="text-gray-500 ml-2">({currentTzAbbr()})</span>}
                            </span>
                            <svg className={`w-4 h-4 text-gray-500 transition-transform ${tzPickerOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>

                        {tzPickerOpen && (
                            <div className="absolute z-50 mt-1 w-full bg-white border border-gray-300 rounded-lg shadow-lg">
                                <div className="p-2 border-b border-gray-200">
                                    <input
                                        type="text"
                                        value={tzSearch}
                                        onChange={(e) => setTzSearch(e.target.value)}
                                        placeholder="Search timezones..."
                                        className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-500"
                                        autoFocus
                                    />
                                </div>
                                <div className="max-h-64 overflow-y-auto">
                                    {Object.entries(groupedTimezones()).map(([region, zones]) => (
                                        <div key={region}>
                                            <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 bg-gray-50 sticky top-0">
                                                {region}
                                            </div>
                                            {zones.map(tz => (
                                                <button
                                                    key={tz.value}
                                                    onClick={() => handleTimezoneSelect(tz.value)}
                                                    className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 transition-colors ${
                                                        tz.value === timezone ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-900'
                                                    }`}
                                                >
                                                    <span>{tz.value.replace(/_/g, ' ')}</span>
                                                    {tz.abbr && <span className="text-gray-500 ml-1">({tz.abbr}, {tz.offset})</span>}
                                                </button>
                                            ))}
                                        </div>
                                    ))}
                                    {filteredTimezones().length === 0 && (
                                        <div className="px-3 py-4 text-sm text-gray-500 text-center">No timezones match your search</div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Notification Preferences Section */}
                {preferences && (
                <div className="bg-white rounded-lg shadow-md p-4 md:p-6 mb-6">
                    <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-1">Notification Preferences</h2>
                    <p className="text-sm text-gray-600 mb-4">Choose how you receive notifications</p>

                    {/* Preferences Matrix */}
                    <div className="space-y-0">
                        {/* Header row */}
                        <div className="flex items-center py-2 border-b border-gray-200">
                            <div className="flex-1 text-sm font-medium text-gray-500">Notification Type</div>
                            <div className="w-16 text-center text-sm font-medium text-gray-500">Email</div>
                            {userData?.sms_enabled && (
                                <div className="w-16 text-center text-sm font-medium text-gray-500">SMS</div>
                            )}
                            <div className="w-20"></div>
                        </div>

                        {NOTIFICATION_TYPES.map(type => (
                            <div key={type.key} className="py-3 border-b border-gray-100 last:border-b-0">
                                <div className="flex items-center">
                                    <div className="flex-1">
                                        <p className="text-sm font-medium text-gray-900">{type.label}</p>
                                        <p className="text-xs text-gray-500">{type.description}</p>
                                    </div>

                                    {/* Email Toggle */}
                                    <div className="w-16 flex justify-center">
                                        <button
                                            onClick={() => handleToggle(type.key, 'email', !preferences[type.key]?.email)}
                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                                preferences[type.key]?.email ? 'bg-indigo-600' : 'bg-gray-200'
                                            }`}
                                            aria-label={`${type.label} email notifications`}
                                        >
                                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                                preferences[type.key]?.email ? 'translate-x-6' : 'translate-x-1'
                                            }`} />
                                        </button>
                                    </div>

                                    {/* SMS Toggle (only when sms_enabled) */}
                                    {userData?.sms_enabled && (
                                        <div className="w-16 flex justify-center">
                                            <button
                                                onClick={() => handleToggle(type.key, 'sms', !preferences[type.key]?.sms)}
                                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                                    preferences[type.key]?.sms ? 'bg-indigo-600' : 'bg-gray-200'
                                                }`}
                                                aria-label={`${type.label} SMS notifications`}
                                            >
                                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                                    preferences[type.key]?.sms ? 'translate-x-6' : 'translate-x-1'
                                                }`} />
                                            </button>
                                        </div>
                                    )}

                                    {/* Status indicator */}
                                    <div className="w-20 text-right">
                                        {saveStatus?.type === type.key && saveStatus.status === 'saving' && (
                                            <span className="text-xs text-gray-400">Saving...</span>
                                        )}
                                        {saveStatus?.type === type.key && saveStatus.status === 'saved' && (
                                            <span className="text-xs text-green-600">Saved</span>
                                        )}
                                        {saveStatus?.type === type.key && saveStatus.status === 'error' && (
                                            <span className="text-xs text-red-500">Error</span>
                                        )}
                                        {saveStatus?.type === type.key && saveStatus.status === 'guard' && (
                                            <span className="text-xs text-red-500">At least one notification must stay enabled</span>
                                        )}
                                    </div>
                                </div>

                                {/* Reminder timing dropdown */}
                                {type.key === 'reminder' && (
                                    <div className="mt-2 ml-0 sm:ml-4 flex items-center gap-2">
                                        <span className="text-xs text-gray-500">Remind me:</span>
                                        <select
                                            value={preferences.reminder?.window_hours ?? 1}
                                            onChange={(e) => handleReminderWindowChange(parseFloat(e.target.value))}
                                            className="text-sm border border-gray-300 rounded px-2 py-1 text-gray-700 bg-white"
                                        >
                                            {REMINDER_WINDOWS.map(w => (
                                                <option key={w.value} value={w.value}>{w.label}</option>
                                            ))}
                                        </select>
                                        {saveStatus?.type === 'reminder' && saveStatus.channel === 'window' && saveStatus.status === 'saved' && (
                                            <span className="text-xs text-green-600">Saved</span>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Reset status */}
                    {saveStatus?.type === 'all' && saveStatus.channel === 'reset' && (
                        <div className="mt-2 text-center">
                            {saveStatus.status === 'saving' && <span className="text-xs text-gray-400">Resetting...</span>}
                            {saveStatus.status === 'saved' && <span className="text-xs text-green-600">Reset to defaults</span>}
                            {saveStatus.status === 'error' && <span className="text-xs text-red-500">Failed to reset</span>}
                        </div>
                    )}

                    {/* Reset to defaults */}
                    <div className="mt-4 text-right">
                        <button
                            onClick={handleResetPreferences}
                            className="text-sm text-gray-500 hover:text-gray-700 underline"
                        >
                            Reset to defaults
                        </button>
                    </div>
                </div>
                )}

                {/* Availability Settings Section */}
                <div className="bg-white rounded-lg shadow-md p-4 md:p-6 mb-6">
                    <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-4">Availability Settings</h2>
                    <p className="text-sm text-gray-600 mb-4">
                        Set the times when you are <strong>available</strong> (free) to help groups find the best time to schedule game sessions. 
                        {googleCalendarConnected && ' Your Google Calendar busy times will be automatically excluded from your availability.'}
                    </p>

                    {/* Tabs */}
                    <div className="flex gap-2 mb-4 border-b">
                        <button
                            onClick={() => setAvailabilityTab('recurring')}
                            className={`px-4 py-2 font-medium text-sm ${
                                availabilityTab === 'recurring'
                                    ? 'border-b-2 border-blue-600 text-blue-600'
                                    : 'text-gray-600 hover:text-gray-900'
                            }`}
                        >
                            Schedules
                        </button>
                        <button
                            onClick={() => setAvailabilityTab('specific')}
                            className={`px-4 py-2 font-medium text-sm ${
                                availabilityTab === 'specific'
                                    ? 'border-b-2 border-blue-600 text-blue-600'
                                    : 'text-gray-600 hover:text-gray-900'
                            }`}
                        >
                            Specific Dates
                        </button>
                    </div>

                    {/* Schedules Tab */}
                    {availabilityTab === 'recurring' && (
                        <div>
                            <div className="flex justify-between items-center mb-4">
                                <div>
                                    <h3 className="font-semibold text-gray-900">Availability Schedules</h3>
                                    <p className="text-xs text-gray-600 mt-1">Set your recurring availability schedule</p>
                                </div>
                                <button
                                    onClick={() => setShowRecurringForm(!showRecurringForm)}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
                                >
                                    {showRecurringForm ? 'Cancel' : '+ Add Schedule'}
                                </button>
                            </div>

                            {showRecurringForm && (
                                <div className="mb-6 p-4 border rounded-lg bg-gray-50">
                                    <h4 className="font-semibold mb-3 text-gray-900">New Schedule</h4>
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Days of Week</label>
                                            <div className="flex flex-wrap gap-2 mt-1">
                                                {[0, 1, 2, 3, 4, 5, 6].map(day => (
                                                    <button
                                                        key={day}
                                                        type="button"
                                                        onClick={() => {
                                                            const days = recurringForm.daysOfWeek;
                                                            setRecurringForm({
                                                                ...recurringForm,
                                                                daysOfWeek: days.includes(day)
                                                                    ? days.filter(d => d !== day)
                                                                    : [...days, day].sort((a, b) => a - b)
                                                            });
                                                        }}
                                                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                                                            recurringForm.daysOfWeek.includes(day)
                                                                ? 'bg-blue-600 text-white border-blue-600'
                                                                : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                                                        }`}
                                                    >
                                                        {getDayName(day).slice(0, 3)}
                                                    </button>
                                                ))}
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setRecurringForm({
                                                            ...recurringForm,
                                                            daysOfWeek: recurringForm.daysOfWeek.length === 7 ? [] : [0, 1, 2, 3, 4, 5, 6]
                                                        });
                                                    }}
                                                    className="px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-300 text-gray-600 hover:border-blue-400 transition-colors"
                                                >
                                                    {recurringForm.daysOfWeek.length === 7 ? 'Clear' : 'All'}
                                                </button>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1">Available From (Start Time)</label>
                                                <input
                                                    type="time"
                                                    value={recurringForm.startTime}
                                                    onChange={(e) => setRecurringForm({ ...recurringForm, startTime: e.target.value })}
                                                    className="w-full p-2 border rounded text-gray-900 bg-white"
                                                />
                                                <p className="text-xs text-gray-500 mt-1">When you become available</p>
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1">Available Until (End Time)</label>
                                                <input
                                                    type="time"
                                                    value={recurringForm.endTime}
                                                    onChange={(e) => setRecurringForm({ ...recurringForm, endTime: e.target.value })}
                                                    className="w-full p-2 border rounded text-gray-900 bg-white"
                                                />
                                                <p className="text-xs text-gray-500 mt-1">When you become unavailable</p>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                                                <input
                                                    type="date"
                                                    value={recurringForm.start_date}
                                                    onChange={(e) => setRecurringForm({ ...recurringForm, start_date: e.target.value })}
                                                    className="w-full p-2 border rounded text-gray-900 bg-white"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1">End Date (Optional)</label>
                                                <input
                                                    type="date"
                                                    value={recurringForm.end_date}
                                                    onChange={(e) => setRecurringForm({ ...recurringForm, end_date: e.target.value })}
                                                    className="w-full p-2 border rounded text-gray-900 bg-white"
                                                />
                                            </div>
                                        </div>
                                        <button
                                            onClick={handleCreateRecurringPattern}
                                            disabled={savingPattern}
                                            className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400"
                                        >
                                            {savingPattern ? 'Saving...' : 'Save Schedule'}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {loadingPatterns ? (
                                <p className="text-gray-600">Loading schedules...</p>
                            ) : (
                                <div className="space-y-2">
                                    {availabilityPatterns
                                        .filter(p => p.type === 'recurring_pattern')
                                        .map(pattern => (
                                            <div key={pattern.id} className="p-3 border rounded-lg flex justify-between items-center">
                                                <div>
                                                    <p className="font-medium text-gray-900">
                                                        {getDayName(pattern.pattern_data.dayOfWeek)}: {pattern.pattern_data.startTime} - {pattern.pattern_data.endTime}
                                                    </p>
                                                    <p className="text-sm text-gray-600">
                                                        {formatDate(pattern.start_date)} - {formatDate(pattern.end_date)}
                                                    </p>
                                                </div>
                                                <button
                                                    onClick={() => handleDeletePattern(pattern.id)}
                                                    className="text-red-600 hover:text-red-700 text-sm"
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        ))}
                                    {availabilityPatterns.filter(p => p.type === 'recurring_pattern').length === 0 && (
                                        <p className="text-gray-600 text-sm">No schedules set. Add one to get started!</p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Specific Dates Tab */}
                    {availabilityTab === 'specific' && (
                        <div>
                            <div className="flex justify-between items-center mb-4">
                                <div>
                                    <h3 className="font-semibold text-gray-900">Specific Date Overrides</h3>
                                    <p className="text-xs text-gray-600 mt-1">Override your schedules for specific dates</p>
                                </div>
                                <button
                                    onClick={() => setShowSpecificForm(!showSpecificForm)}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
                                >
                                    {showSpecificForm ? 'Cancel' : '+ Add Override'}
                                </button>
                            </div>

                            {showSpecificForm && (
                                <div className="mb-6 p-4 border rounded-lg bg-gray-50">
                                    <h4 className="font-semibold mb-3 text-gray-900">New Specific Override</h4>
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                                            <input
                                                type="date"
                                                value={specificForm.date}
                                                onChange={(e) => setSpecificForm({ ...specificForm, date: e.target.value })}
                                                className="w-full p-2 border rounded text-gray-900 bg-white"
                                            />
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1">Available From (Start Time)</label>
                                                <input
                                                    type="time"
                                                    value={specificForm.startTime}
                                                    onChange={(e) => setSpecificForm({ ...specificForm, startTime: e.target.value })}
                                                    className="w-full p-2 border rounded text-gray-900 bg-white"
                                                />
                                                <p className="text-xs text-gray-500 mt-1">When you become available</p>
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1">Available Until (End Time)</label>
                                                <input
                                                    type="time"
                                                    value={specificForm.endTime}
                                                    onChange={(e) => setSpecificForm({ ...specificForm, endTime: e.target.value })}
                                                    className="w-full p-2 border rounded text-gray-900 bg-white"
                                                />
                                                <p className="text-xs text-gray-500 mt-1">When you become unavailable</p>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="flex items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    checked={specificForm.isAvailable}
                                                    onChange={(e) => setSpecificForm({ ...specificForm, isAvailable: e.target.checked })}
                                                    className="rounded"
                                                />
                                                <span className="text-sm text-gray-700">Mark as available (uncheck to mark as busy)</span>
                                            </label>
                                        </div>
                                        <button
                                            onClick={handleCreateSpecificOverride}
                                            disabled={savingPattern}
                                            className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400"
                                        >
                                            {savingPattern ? 'Saving...' : 'Save Override'}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {loadingPatterns ? (
                                <p className="text-gray-600">Loading overrides...</p>
                            ) : (
                                <div className="space-y-2">
                                    {availabilityPatterns
                                        .filter(p => p.type === 'specific_override')
                                        .map(pattern => (
                                            <div key={pattern.id} className="p-3 border rounded-lg flex justify-between items-center">
                                                <div>
                                                    <p className="font-medium text-gray-900">
                                                        {formatDate(pattern.pattern_data.date)}: {pattern.pattern_data.startTime} - {pattern.pattern_data.endTime}
                                                    </p>
                                                    <p className="text-sm text-gray-600">
                                                        {pattern.is_available ? 'Available' : 'Busy'}
                                                    </p>
                                                </div>
                                                <button
                                                    onClick={() => handleDeletePattern(pattern.id)}
                                                    className="text-red-600 hover:text-red-700 text-sm"
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        ))}
                                    {availabilityPatterns.filter(p => p.type === 'specific_override').length === 0 && (
                                        <p className="text-gray-600 text-sm">No specific overrides set. Add one to override your default availability!</p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Tutorial Section */}
                <div className="bg-white rounded-lg shadow-md p-4 md:p-6 mb-6">
                    <h2 className="text-lg font-bold text-gray-900 mb-2">Tutorial</h2>
                    <p className="text-sm text-gray-600 mb-4">
                        Need a refresher on how to use Next Game Night? Replay the onboarding tutorial to walk through the key features.
                    </p>
                    <button
                        onClick={handleReplayTutorial}
                        disabled={replayingTutorial}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm disabled:bg-gray-400"
                    >
                        {replayingTutorial ? 'Starting...' : 'Replay Tutorial'}
                    </button>
                </div>

                {/* Owned Games Section */}
                <div className="bg-white rounded-lg shadow-md p-4 md:p-6">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
                        <h2 className="text-xl md:text-2xl font-bold text-gray-900">My Game Collection ({ownedGames.length})</h2>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setShowBggSearch(!showBggSearch)}
                                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm whitespace-nowrap"
                            >
                                {showBggSearch ? 'Hide Search' : '+ Add from BGG'}
                            </button>
                        </div>
                    </div>

                    {/* BGG Collection Import */}
                    <div className="mb-6 p-3 md:p-4 border rounded-lg bg-gray-50">
                        <h3 className="font-semibold mb-2 text-gray-900 text-sm md:text-base">Import Your Entire BGG Collection</h3>
                        <p className="text-xs md:text-sm text-gray-600 mb-3">
                            Enter your BoardGameGeek username to import all games from your BGG collection at once.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-2">
                            <input
                                type="text"
                                value={bggUsername}
                                onChange={(e) => setBggUsername(e.target.value)}
                                placeholder="Your BGG username"
                                className="flex-1 p-2 border rounded text-gray-900 bg-white text-sm md:text-base"
                                disabled={importingCollection}
                            />
                            <button
                                onClick={importBGGCollection}
                                disabled={importingCollection || !bggUsername.trim()}
                                className="bg-green-600 text-white px-4 md:px-6 py-2 rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed text-sm md:text-base whitespace-nowrap"
                            >
                                {importingCollection ? 'Importing...' : 'Import Collection'}
                            </button>
                        </div>
                        {importProgress && (
                            <div className={`mt-3 p-3 rounded ${
                                importProgress.status === 'error' ? 'bg-red-50 text-red-800' :
                                importProgress.status === 'complete' ? 'bg-green-50 text-green-800' :
                                'bg-blue-50 text-blue-800'
                            }`}>
                                <p className="font-medium">{importProgress.message}</p>
                                {importProgress.details && (
                                    <p className="text-sm mt-1">
                                        Imported: {importProgress.details.imported} | 
                                        Skipped (already owned): {importProgress.details.skipped} | 
                                        Total: {importProgress.details.total}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>

                    {/* BGG Search */}
                    {showBggSearch && (
                        <div className="mb-6 p-3 md:p-4 border rounded bg-gray-50">
                            <div className="flex flex-col sm:flex-row gap-2 mb-3">
                                <input
                                    type="text"
                                    value={bggSearchQuery}
                                    onChange={(e) => setBggSearchQuery(e.target.value)}
                                    onKeyPress={(e) => e.key === 'Enter' && searchBGG()}
                                    placeholder="Search BoardGameGeek..."
                                    className="flex-1 p-2 border rounded text-gray-900 bg-white text-sm md:text-base"
                                />
                                <button
                                    onClick={searchBGG}
                                    disabled={bggSearching || !bggSearchQuery.trim()}
                                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 text-sm md:text-base whitespace-nowrap"
                                >
                                    {bggSearching ? 'Searching...' : 'Search'}
                                </button>
                            </div>
                            
                            {bggSearchResults.length > 0 && (
                                <div className="max-h-60 overflow-y-auto space-y-2">
                                    {bggSearchResults.map((result) => {
                                        const isAlreadyOwned = ownedGames.some(g => g.bgg_id === result.bgg_id);
                                        return (
                                            <div key={result.bgg_id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 bg-white border rounded">
                                                <span className="text-sm text-gray-900 break-words flex-1 min-w-0">
                                                    {result.name} {result.year_published ? `(${result.year_published})` : ''}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => addGameToCollection(result.bgg_id)}
                                                    disabled={isAlreadyOwned}
                                                    className="text-xs px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400 whitespace-nowrap flex-shrink-0"
                                                >
                                                    {isAlreadyOwned ? 'Already Owned' : 'Add to Collection'}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Owned Games List */}
                    {loadingGames ? (
                        <p className="text-gray-600">Loading your collection...</p>
                    ) : ownedGames.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {ownedGames.map((game) => (
                                <div key={game.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex-1">
                                            <h3 className="font-semibold text-gray-900">{game.name}</h3>
                                            {game.year_published && (
                                                <p className="text-sm text-gray-600">({game.year_published})</p>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => removeGameFromCollection(game.id)}
                                            className="text-red-500 hover:text-red-700 text-sm"
                                            title="Remove from collection"
                                        >
                                            ×
                                        </button>
                                    </div>
                                    <SafeImage
                                        src={game.image_url}
                                        alt={game.name}
                                        className="w-full h-32 object-cover rounded mb-2"
                                    />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-gray-600">You don't have any games in your collection yet. Search BoardGameGeek to add games!</p>
                    )}
                </div>
            </div>
        )
    );
}

export default Profile;