
import * as realApi from './endpoints.js';
import { supabase } from '../supabase.js';
import { ApiError } from './client.js';
import { quizFromApi } from './adapters.js';

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
 * Create a quiz through the secure Supabase Edge Function.
 */
async function createQuiz(input) {
    const { data, error } = await supabase.functions.invoke(
        'quiz-admin-create',
        {
            body: {
                title: input.title
            }
        }
    );

    if (error) {
        let status = error.context?.status || 500;
        let message = 'Unable to create the quiz.';
        let code = 'QUIZ_CREATION_FAILED';

        try {
            const responseBody = await error.context?.json();

            if (responseBody?.error) {
                message = responseBody.error;
            }
        } catch {
            // Keep the default error message.
        }

        if (status === 401) {
            code = 'UNAUTHORIZED';
            message = 'Your session has expired. Please sign in again.';
        } else if (status === 403) {
            code = 'FORBIDDEN';
            message = 'You are not authorised to create quizzes.';
        } else if (status === 400) {
            code = 'VALIDATION_ERROR';
        }

        throw new ApiError({
            status,
            code,
            message
        });
    }

    if (!data?.quiz) {
        throw new ApiError({
            status: 500,
            code: 'INVALID_RESPONSE',
            message: 'The server did not return the created quiz.'
        });
    }

    return quizFromApi(data);
}

/**
 * Keep the existing quiz API functions.
 * Authentication and quiz creation now use Supabase.
 */
export const api = {
    ...realApi,
    login,
    getMe,
    logout,
    createQuiz
};
