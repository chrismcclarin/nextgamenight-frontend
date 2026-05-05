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

  // GROUP-08: post-invite-accept refresh handoff. The /invite/group/[token]
  // success branch sets sessionStorage 'nggroups:refresh'='1' before navigating
  // to the new group page. When the user later returns to /userHome, this
  // mount-only effect consumes the flag and bumps groupListRefreshKey so the
  // groups list re-fetches and reflects the freshly-joined group without a
  // manual reload. Pattern mirrors Phase 64-01's eventsRefreshKey defensive bump.
  useEffect(() => {
    if (typeof window === 'undefined') return; // SSR guard
    if (sessionStorage.getItem('nggroups:refresh') === '1') {
      sessionStorage.removeItem('nggroups:refresh');
      setGroupListRefreshKey(prev => prev + 1);
    }
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
