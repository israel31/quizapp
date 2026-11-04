
import * as realApi from './endpoints.js';
import { supabase } from '../supabase.js';
import { ApiError } from './client.js';

export const isDemoMode = false;

/**
 * Verify that the signed-in Supabase user is an active quiz administrator.
 */
async function verifyQuizAdmin(user) {
    const { data, error } = await supabase.rpc('quiz_admin_me');

    if (error) {
        throw new ApiError({
            status: 500,
            code: 'ADMIN_VERIFICATION_FAILED',
            message: 'Unable to verify administrator access.'
        });
    }

    if (!data || data.is_active !== true) {
        await supabase.auth.signOut();

        throw new ApiError({
            status: 403,
            code: 'ADMIN_ACCESS_DENIED',
            message: 'This account is not authorised to access the quiz dashboard.'
        });
    }

    return {
        id: user.id,
        name: user.email?.split('@')[0] || 'Administrator',
        email: user.email || '',
        role: data.role || 'admin'
    };
}

/**
 * Sign in using Supabase email and password.
 */
async function login({ identifier, password }) {
    const { data, error } = await supabase.auth.signInWithPassword({
        email: identifier.trim(),
        password
    });

    if (error || !data.user) {
        throw new ApiError({
            status: 401,
            code: 'INVALID_CREDENTIALS',
            message: 'Email or password is incorrect.'
        });
    }

    try {
        return await verifyQuizAdmin(data.user);
    } catch (error) {
        await supabase.auth.signOut();
        throw error;
    }
}

/**
 * Check the current Supabase session.
 */
async function getMe() {
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
        throw new ApiError({
            status: 401,
            code: 'UNAUTHENTICATED',
            message: 'Please sign in.'
        });
    }

    return verifyQuizAdmin(data.user);
}

/**
 * Sign out from Supabase.
 */
async function logout() {
    const { error } = await supabase.auth.signOut();

    if (error) {
        throw new ApiError({
            status: 500,
            code: 'SIGN_OUT_FAILED',
            message: 'Unable to sign out.'
        });
    }
}

/**
 * Keep the existing quiz API functions.
 * Only authentication is being replaced at this stage.
 */
export const api = {
    ...realApi,
    login,
    getMe,
    logout
};
