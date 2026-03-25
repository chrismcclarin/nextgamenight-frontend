'use client';

import { useState, useEffect, useCallback } from 'react';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { useSearchParams } from 'next/navigation';
import { userGamesAPI, gamesAPI, googleCalendarAPI, usersAPI, availabilityAPI } from '../../lib/api';
import Link from 'next/link';
import { formatDate } from '../../lib/dateUtils';
import SafeImage from '../components/SafeImage';
import { useTutorial } from '../components/tutorial/TutorialProvider';

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
        dayOfWeek: 0,
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

    const { replayTutorial } = useTutorial();

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

    const fetchUserData = useCallback(async () => {
        if (!user?.sub) return;
        try {
            const userInfo = await usersAPI.getUser(user.sub);
            setUserData(userInfo);
            setUsername(userInfo.username || user.name || user.email?.split('@')[0] || '');
        } catch (error) {
            console.error('Error fetching user data:', error);
            // Fallback to Auth0 user data
            setUsername(user.name || user.email?.split('@')[0] || 'User');
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
        try {
            setSavingPattern(true);
            // Remove end_date if it's empty to avoid validation errors
            const formData = { ...recurringForm };
            if (!formData.end_date || formData.end_date.trim() === '') {
                delete formData.end_date;
            }
            await availabilityAPI.createRecurringPattern(user.sub, formData);
            await fetchAvailabilityPatterns();
            setShowRecurringForm(false);
            setRecurringForm({
                dayOfWeek: 0,
                startTime: '09:00',
                endTime: '17:00',
                start_date: new Date().toISOString().split('T')[0],
                end_date: '',
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
            });
            alert('Schedule created successfully!');
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
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Day of Week</label>
                                            <select
                                                value={recurringForm.dayOfWeek}
                                                onChange={(e) => setRecurringForm({ ...recurringForm, dayOfWeek: parseInt(e.target.value) })}
                                                className="w-full p-2 border rounded text-gray-900 bg-white"
                                            >
                                                {[0, 1, 2, 3, 4, 5, 6].map(day => (
                                                    <option key={day} value={day}>{getDayName(day)}</option>
                                                ))}
                                            </select>
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