'use client'
import { useState } from 'react';
import { usersAPI, groupsAPI } from '../../lib/api';

function AddMember({URL, group, modaltoggle, modal, onMemberAdded}){
    const [userSearch, setUserSearch] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const handleChange = (event) => {
        setUserSearch(event.target.value);
        setError(""); // Clear error when user types
    }

    const onSubmit = async (e) => {
        e.preventDefault();
        
        if (!userSearch.trim()) {
            setError("Please enter an email address");
            return;
        }

        if (!group?.id) {
            setError("Group information is missing");
            return;
        }

        setLoading(true);
        setError("");

        try {
            await addUserToGroup(userSearch.trim());
            setUserSearch("");
            modaltoggle();
            if (onMemberAdded) {
                onMemberAdded();
            }
        } catch (error) {
            console.error('Error adding member:', error);
            setError(error.message || "Failed to add member");
        } finally {
            setLoading(false);
        }
    }

    const addUserToGroup = async (email) => {
        // First, find the user by email using usersAPI which includes Authorization header
        let user;
        try {
            user = await usersAPI.searchUserByEmail(email);
        } catch (error) {
            if (error.message && error.message.includes('404') || error.message && error.message.includes('not found')) {
                throw new Error("User not found. Please make sure they have signed up.");
            }
            throw new Error(error.message || "Failed to find user");
        }

        // Check if user is already in the group by fetching current members
        // Use groupsAPI.getGroupMembers which includes Authorization header
        try {
            const members = await groupsAPI.getGroupMembers(group.id);
            if (Array.isArray(members)) {
                const isAlreadyMember = members.some(m => m.user_id === user.user_id);
                if (isAlreadyMember) {
                    throw new Error("User is already a member of this group");
                }
            }
        } catch (error) {
            // If error is about already being a member, re-throw it
            if (error.message && error.message.includes('already a member')) {
                throw error;
            }
            // Otherwise, continue - the check failed but we'll try to add anyway
        }

        // Add user to group using groupsAPI which includes Authorization header
        await groupsAPI.addUserToGroup(group.id, user.user_id);
        
        return { success: true, user };
    }


if (!modal) return null;

    return (
        <div
            className="justify-center items-center flex overflow-x-hidden overflow-y-auto fixed inset-0 z-50 outline-none focus:outline-none bg-black bg-opacity-50"
        >
            <div className="relative w-auto my-6 mx-auto max-w-sm">
                {/*content*/}
                <div className="border-0 rounded-lg shadow-lg relative flex flex-col w-full bg-white outline-none focus:outline-none">
                    {/*header*/}
                    <div className="flex items-start justify-between p-5 border-b border-solid border-blueGray-200 rounded-t">
                        <h3 className="text-3xl text-black font-semibold">
                            Add Member
                        </h3>
                        <button
                            className="text-gray-500 hover:text-gray-700 text-2xl"
                            onClick={modaltoggle}
                            type="button"
                        >
                            ×
                        </button>
                    </div>
                    <form onSubmit={onSubmit} className="relative p-6 flex-auto">
                        <div className="mb-3 pt-0">
                            <label htmlFor="email" className="block text-sm font-medium mb-1">
                                Email Address
                            </label>
                            <input 
                                id="email" 
                                onChange={handleChange} 
                                value={userSearch} 
                                type="email" 
                                placeholder="user@example.com" 
                                required
                                disabled={loading}
                                className="px-3 py-3 placeholder-blueGray-300 text-black relative bg-white rounded text-sm border-0 shadow outline-none focus:outline-none focus:ring w-full disabled:opacity-50"
                            />
                            {error && (
                                <p className="text-red-500 text-sm mt-1">{error}</p>
                            )}
                        </div>
                        <div className="flex items-center justify-end p-6 border-t border-solid border-blueGray-200 rounded-b gap-2">
                            <button
                                className="text-gray-500 background-transparent font-bold uppercase px-6 py-2 text-sm outline-none focus:outline-none ease-linear transition-all duration-150 hover:text-gray-700"
                                type="button"
                                onClick={modaltoggle}
                                disabled={loading}
                            >
                                Cancel
                            </button>
                            <button
                                className="bg-emerald-500 text-white active:bg-emerald-600 font-bold uppercase text-sm px-6 py-3 rounded shadow hover:shadow-lg outline-none focus:outline-none mr-1 mb-1 ease-linear transition-all duration-150 disabled:opacity-50"
                                type="submit"
                                disabled={loading}
                            >
                                {loading ? "Adding..." : "Add Member"}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}

export default AddMember;