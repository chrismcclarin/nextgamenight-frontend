'use client'

import { useState, useEffect } from 'react';
import { useUser as Auth} from '@auth0/nextjs-auth0/client';
import "./globals.css"
import CreateGroup from './components/createGroup';
import UserHome from './userHome/UserHomePage';
import LandingPage from './components/LandingPage';
import { groupsAPI } from '../lib/api';

function App(){
  // Backend API URL
  const URL = `http://localhost:4000/api`;

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
        <div className="text-red-500">Error: {error.message}</div>
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
        URL={URL} 
        modal={groupModal} 
        modaltoggle={modaltoggle} 
        getGroupList={getGroupList}
        onGroupCreated={() => setGroupListRefreshKey(prev => prev + 1)}
      />
      
      {/* Show list of groups */}
      <UserHome 
        getGroupList={getGroupList} 
        GroupList={GroupList} 
        URL={URL}
        onCreateGroup={modaltoggle}
        groupListRefreshKey={groupListRefreshKey}
        onMemberAdded={() => setGroupListRefreshKey(prev => prev + 1)}
      />
    </div>
  );
}

export default App;
