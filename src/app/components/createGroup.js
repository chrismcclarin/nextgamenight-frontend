'use client'
import { useState } from 'react';
import { groupsAPI } from '../../lib/api';
import FriendInvitePanel from './FriendInvitePanel';

function CreateGroup({user, modal, modaltoggle, getGroupList, onGroupCreated}){

    const groupForm = {
        name: "",
        user_id: user?.sub || ""
    }

    const [newGroup, setNewGroup] = useState(groupForm)
    const [errorMessage, setErrorMessage] = useState('')
    const [createdGroup, setCreatedGroup] = useState(null)

    const handleChange = (event) => {
        setNewGroup({...newGroup, [event.target.id]: event.target.value})
        // Clear error message when user starts typing
        if (errorMessage) {
            setErrorMessage('')
        }
    }

    const onSubmit = async (e) => {
        e.preventDefault();
        if (!newGroup.name.trim()) {
            alert('Please enter a group name');
            return;
        }
        try {
            setErrorMessage(''); // Clear any previous errors
            const data = await createNewGroup(newGroup);
            setNewGroup(groupForm);
            modaltoggle();
            // Open the invite panel for the newly created group
            setCreatedGroup(data);
        } catch (error) {
            console.error('Error creating group:', error);
            // Show the actual error message from the API
            const errorMsg = error.message || 'Failed to create group. Please try again.';
            setErrorMessage(errorMsg);
        }
    }

    const createNewGroup = async (group) => {
        // Use groupsAPI.createGroup which automatically includes Authorization header
        const data = await groupsAPI.createGroup({
            name: group.name
        });

        // Refresh the group list after successful creation
        if (getGroupList) {
            getGroupList();
        }
        // Trigger refresh in GroupList component
        if (onGroupCreated) {
            onGroupCreated();
        }
        return data;
    }

    const handleInvitePanelClose = () => {
        setCreatedGroup(null);
    };

    const handleMemberAdded = () => {
        if (getGroupList) {
            getGroupList();
        }
        if (onGroupCreated) {
            onGroupCreated();
        }
    };

    return (
        <>
            {modal && (
                <div
                    className="justify-center items-center flex overflow-x-hidden overflow-y-auto fixed inset-0 z-50 outline-none focus:outline-none"
                >
                    <div className="relative w-auto my-6 mx-auto max-w-sm">
                        {/*content*/}
                        <div className="border-0 rounded-lg shadow-lg relative flex flex-col w-full bg-white outline-none focus:outline-none">
                            {/*header*/}
                            <div className="flex items-start justify-between p-5 border-b border-solid border-blueGray-200 rounded-t">
                                <h3 className="text-3xl text-black font-semibold">
                                    Create a new Group
                                </h3>
                            </div>
                            <form onSubmit={onSubmit} autoComplete="off" className="relative p-6 flex-auto">
                                <div className="mb-3 pt-0">
                                    <div className="relative">
                                        <input
                                            id="name"
                                            name="group-name-create"
                                            onChange={handleChange}
                                            value={newGroup.name}
                                            type="text"
                                            placeholder="Group Name"
                                            required
                                            maxLength={40}
                                            autoComplete="off"
                                            className="px-3 py-3 placeholder-blueGray-300 text-black relative bg-white rounded text-sm border-0 shadow outline-none focus:outline-none focus:ring w-full pr-16"
                                        />
                                        <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
                                            {newGroup.name.length}/40
                                        </span>
                                    </div>
                                    {errorMessage && (
                                        <p className="mt-2 text-sm text-red-600">{errorMessage}</p>
                                    )}
                                </div>
                                <div className="flex items-center justify-end p-6 border-t border-solid border-blueGray-200 rounded-b">
                                    <button
                                        className="bg-emerald-500 text-white active:bg-emerald-600 font-bold uppercase text-sm px-6 py-3 rounded shadow hover:shadow-lg outline-none focus:outline-none mr-1 mb-1 ease-linear transition-all duration-150"
                                        type="submit"
                                    >
                                        Create Group
                                    </button>
                                </div>
                            </form>
                                <button
                                    className="text-red-500 background-transparent font-bold uppercase px-6 py-2 text-sm outline-none focus:outline-none mr-1 mb-1 ease-linear transition-all duration-150"
                                    type="button"
                                    onClick={modaltoggle}
                                >
                                    Close
                                </button>
                        </div>
                    </div>
                </div>
            )}

            <FriendInvitePanel
                group={createdGroup}
                open={!!createdGroup}
                onClose={handleInvitePanelClose}
                onMemberAdded={handleMemberAdded}
            />
        </>
    );
}

export default CreateGroup;
