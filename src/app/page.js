'use client'

import { useState, useEffect } from 'react';
import { useUser as Auth} from '@auth0/nextjs-auth0/client';
import "./globals.css"
import CreateGroup from './components/createGroup';
import UserHome from './userHome/UserHomePage';
import LandingPage from './components/LandingPage';
import { groupsAPI, API_BASE_URL } from '../lib/api';
import { useSelfIdentity } from '../lib/hooks/useSelfIdentity';
import { logger, errCtx } from '@/lib/logger';

function App(){

  // List of groups associated with the logged-in user
  const [GroupList, setGroupList] = useState(null);

  // User information from Auth0
  const { user, error, isLoading } = Auth();

  // Resolve the caller's own Users.id UUID via the shared identity primitive.
  // getGroupList sends this instead of the Auth0 sub; it resolves ASYNC after
  // mount, so the mount effect keys on it (async-resolution rule).
  const { selfUuid } = useSelfIdentity();
  
  // Open and close the create group modal
  const [groupModal, setGroupModal] = useState(false);
  
  // Refresh trigger for group list
  const [groupListRefreshKey, setGroupListRefreshKey] = useState(0);

  // Fetch groups for the logged-in user
  const getGroupList = async () => {
    // Mount-fire gate: wait for the caller's own Users.id UUID to resolve.
    if (!selfUuid) return;
    try {
      // Use groupsAPI.getUserGroups which automatically includes Authorization header
      const data = await groupsAPI.getUserGroups(selfUuid);
      setGroupList(data);
    } catch (error) {
      // DEVELOPER LOG, not a user-facing read. This is the designed destination for the raw
      // error text; nothing here renders. It is exempted PER LINE by the R1 gate's developer-log
      // rule, NEVER by file — that gate scans the whole `src/` tree and excludes no file by name,
      // which is exactly why the LIVE render further down this same file is seen separately.
      //
      // DECISION Phase 88.6-34 (AC-2 WIDENED 2026-09-09, level AMENDED 2026-09-13): `logger.info`,
      // chosen OVER `logger.error` and OVER `logger.warn`. `logger.error` is `captureException`
      // with no throttle, dedupe or level gate, and `replaysOnErrorSampleRate` (1.0) against
      // `replaysSessionSampleRate` (0.1) means most sessions are BUFFERING — so the first captured
      // event flushes the Session Replay buffer and converts that session to continuous recording
      // and upload, replay egress bought for a gate that only asked for the raw call to go.
      // `logger.warn` is not cheaper (`captureMessage` is an event too, so the flush is identical);
      // only `logger.info` is event-free. What changed is the CHANNEL and the lint gate, NOT the
      // egress: this was a breadcrumb at most before and is a breadcrumb now.
      //
      // The ARGUMENT changed too, and that is the point: it used to forward
      // `error.message || 'Unknown error'`, a pre-stringified upstream message that threw away the
      // error's CLASS. `errCtx` carries name AND message in the ctx object — and it is used rather
      // than a hand-written `{ name, message }` literal on purpose: the literal spells `message:`
      // on this line and would match the R1 scanner's user-facing-sink pattern, reddening a gate a
      // correct conversion never touched. Never pass the raw `Error` as the ctx: the signature is
      // `Record<string, unknown>` and a `.js` call site gets no typecheck. Converts IN PLACE
      // because this is a catch inside an async handler, not a render body or a per-item loop.
      //
      // NOT FIXED HERE, and a converted log line must not be read as if it were: this catch logs
      // and RETURNS. `setGroupList` is never called on the failure path, so a failed fetch renders
      // the signed-in home page as "you have no groups" — no error state, no retry. Routed with
      // its two siblings in `.planning/deferred/phase-88.6.md`; the fix is the shipped
      // `useFetchErrorState` / `FetchErrorBanner` pattern and it is an owner call, not a cleanup.
      logger.info('Error fetching groups:', errCtx(error));
    }
  };

  // Load groups when user is available. selfUuid is in the dependency array per
  // the async-resolution rule — the fetch re-fires once identity resolves.
  useEffect(() => {
    if (user) {
      getGroupList();
    }
  }, [user, selfUuid]);

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
        <div className="text-content-status-error">Error: {error.message}</div>
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
