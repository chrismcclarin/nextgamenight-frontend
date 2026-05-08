'use client'

import { useState, useEffect } from 'react';
import { useUser as Auth} from '@auth0/nextjs-auth0/client';
import "./globals.css"
import CreateGroup from './components/createGroup';
import UserHome from './userHome/UserHomePage';
import LandingPage from './components/LandingPage';
import { groupsAPI, API_BASE_URL } from '../lib/api';

function App(){

  // List of groups associated with the logged-in user
  const [GroupList, setGroupList] = useState(null);
  
  // User information from Auth0
  const { user, error, isLoading } = Auth();
  
  // Open and close the create group modal
  const [groupModal, setGroupModal] = useState(false);
  
  // Refresh trigger for group list
  const [groupListRefreshKey, setGroupListRefreshKey] = useState(0);

  // Fetch groups for the logged-in user
  const getGroupList = async () => {
    if (!user?.sub) return;
    try {
      // Use groupsAPI.getUserGroups which automatically includes Authorization header
      const data = await groupsAPI.getUserGroups(user.sub);
      setGroupList(data);
    } catch (error) {
      console.error('Error fetching groups:', error.message || 'Unknown error');
    }
  };

  // Load groups when user is available
  useEffect(() => {
    if (user) {
      getGroupList();
    }
  }, [user]);

  // GROUP-08: post-invite-accept refresh handoff. Two trigger paths land here.
  // (a) sessionStorage flag — set by /invite/group/[token] and /invite/accept
  //     after a successful join, then consumed on next mount (covers cross-tab
  //     navigation back to home).
  // (b) window 'nggroups:refresh' event — dispatched by NotificationBell when
  //     the user accepts an invite from the bell while already on this page
  //     (no remount, so the sessionStorage check above doesn't fire).
  useEffect(() => {
    if (typeof window === 'undefined') return; // SSR guard
    if (sessionStorage.getItem('nggroups:refresh') === '1') {
      sessionStorage.removeItem('nggroups:refresh');
      setGroupListRefreshKey(prev => prev + 1);
    }
    const onRefresh = () => {
      sessionStorage.removeItem('nggroups:refresh');
      setGroupListRefreshKey(prev => prev + 1);
    };
    window.addEventListener('nggroups:refresh', onRefresh);
    return () => window.removeEventListener('nggroups:refresh', onRefresh);
  }, []);

  // ONBD-04 (Phase 73): cold-branch tutorial handoff.
  // The TutorialOverlay can't call modaltoggle directly (state lives here), so
  // it dispatches 'ngtutorial:openCreateGroup' on the window. We listen here
  // and force the CreateGroup modal open. setGroupModal(true) is deterministic
  // — using modaltoggle would close the modal if it happened to be open already.
  // Mirrors the 'nggroups:refresh' listener pattern above.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOpenCreateGroup = () => {
      setGroupModal(true);
    };
    window.addEventListener('ngtutorial:openCreateGroup', onOpenCreateGroup);
    return () => window.removeEventListener('ngtutorial:openCreateGroup', onOpenCreateGroup);
  }, []);

  const modaltoggle = () => {
    setGroupModal(!groupModal);
  }

  if (isLoading) {
    return (
      <div className="App flex items-center justify-center min-h-screen">
        <p>Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="App flex items-center justify-center min-h-screen">
        <div className="text-status-error">Error: {error.message}</div>
      </div>
    );
  }

  if (!user) {
    return <LandingPage />;
  }

  return (
    <div className="App">
      {/* Create group modal (button is in GroupList component) */}
      <CreateGroup 
        user={user} 
        modal={groupModal} 
        modaltoggle={modaltoggle} 
        getGroupList={getGroupList}
        onGroupCreated={() => setGroupListRefreshKey(prev => prev + 1)}
      />
      
      {/* Show list of groups */}
      <UserHome 
        getGroupList={getGroupList} 
        GroupList={GroupList} 
        onCreateGroup={modaltoggle}
        groupListRefreshKey={groupListRefreshKey}
        onMemberAdded={() => setGroupListRefreshKey(prev => prev + 1)}
      />
    </div>
  );
}

export default App;
