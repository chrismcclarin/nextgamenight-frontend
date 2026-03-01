'use client'
import { useState } from 'react';
import { invitesAPI } from '../../lib/api';

function InviteMember({ group, modaltoggle, modal, onMemberAdded }) {
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    const handleChange = (event) => {
        setEmail(event.target.value);
        setError(""); // Clear error when user types
        setSuccess(""); // Clear success when user types
    }

    const onSubmit = async (e) => {
        e.preventDefault();

        if (!email.trim()) {
            setError("Please enter an email address");
            return;
        }

        if (!group?.id) {
            setError("Group information is missing");
            return;
        }

        setLoading(true);
        setError("");
        setSuccess("");

        try {
            await invitesAPI.sendInvite(group.id, email.trim());
            setSuccess(`Invite sent to ${email.trim()}`);
            setEmail("");
            // Refresh parent data (e.g., member count)
            if (onMemberAdded) {
                onMemberAdded();
            }
            // Clear success message after 5 seconds
            setTimeout(() => {
                setSuccess("");
            }, 5000);
        } catch (err) {
            console.error('Error sending invite:', err);
            const message = err.message || "";
            if (message.includes("already a member")) {
                setError("This person is already a member of the group");
            } else if (message.includes("pending invite") || message.includes("already been invited")) {
                setError("This person already has a pending invite");
            } else {
                setError("Failed to send invite");
            }
        } finally {
            setLoading(false);
        }
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
                            Invite Member
                        </h3>
                        <button
                            className="text-gray-500 hover:text-gray-700 text-2xl"
                            onClick={modaltoggle}
                            type="button"
                        >
                            &times;
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
                                value={email}
                                type="email"
                                placeholder="user@example.com"
                                required
                                disabled={loading}
                                className="px-3 py-3 placeholder-blueGray-300 text-black relative bg-white rounded text-sm border-0 shadow outline-none focus:outline-none focus:ring w-full disabled:opacity-50"
                            />
                            {error && (
                                <p className="text-red-500 text-sm mt-1">{error}</p>
                            )}
                            {success && (
                                <p className="text-green-600 text-sm mt-1">{success}</p>
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
                                {loading ? "Sending..." : "Send Invite"}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}

export { InviteMember };
export default InviteMember;
