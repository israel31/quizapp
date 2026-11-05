import * as realApi from './endpoints.js';
import { supabase } from '../supabase.js';
import { ApiError } from './client.js';
import {
    quizFromApi,
    quizPageFromApi,
    quizPatchToApi,
    questionCreateToApi,
    questionUpdateToApi
} from './adapters.js';

export const isDemoMode = false;

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

async function listQuizzes(query = {}) {
    const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

    const session = sessionData?.session;

    if (sessionError || !session?.access_token) {
        throw new ApiError({
            status: 401,
            code: 'UNAUTHENTICATED',
            message: 'Please sign in again.'
        });
    }

    const params = new URLSearchParams();

    if (query.q) params.set('q', query.q);
    if (query.status) params.set('status', query.status);
    if (query.availability) {
        params.set('availability', query.availability);
    }
    if (query.sort) params.set('sort', query.sort);
    if (query.page) params.set('page', String(query.page));
    if (query.pageSize) {
        params.set('pageSize', String(query.pageSize));
    }
    if (query.hasAttempts) {
        params.set('hasAttempts', 'true');
    }

    const url =
        `${supabase.supabaseUrl}/functions/v1/quiz-admin-list` +
        (params.toString() ? `?${params.toString()}` : '');

    let response;

    try {
        response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'apikey': supabase.supabaseKey,
                'Authorization': `Bearer ${session.access_token}`
            }
        });
    } catch {
        throw new ApiError({
            status: 503,
            code: 'NETWORK_ERROR',
            message: 'Unable to connect to the quiz server.'
        });
    }

    let result;

    try {
        result = await response.json();
    } catch {
        throw new ApiError({
            status: 500,
            code: 'INVALID_RESPONSE',
            message: 'The server returned an invalid response.'
        });
    }

    if (!response.ok) {
        let code = 'QUIZ_LIST_FAILED';

        if (response.status === 401) code = 'UNAUTHORIZED';
        if (response.status === 403) code = 'FORBIDDEN';

        throw new ApiError({
            status: response.status,
            code,
            message: result?.error || 'Unable to load quizzes.'
        });
    }

    return quizPageFromApi(result);
}

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
        const status = error.context?.status || 500;
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

async function getQuiz(id, { signal } = {}) {
    const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

    const session = sessionData?.session;

    if (sessionError || !session?.access_token) {
        throw new ApiError({
            status: 401,
            code: 'UNAUTHENTICATED',
            message: 'Please sign in again.'
        });
    }

    const url =
        `${supabase.supabaseUrl}/functions/v1/quiz-admin-get` +
        `?id=${encodeURIComponent(id)}`;

    let response;

    try {
        response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'apikey': supabase.supabaseKey,
                'Authorization': `Bearer ${session.access_token}`
            },
            signal
        });
    } catch (error) {
        if (error.name === 'AbortError') throw error;

        throw new ApiError({
            status: 503,
            code: 'NETWORK_ERROR',
            message: 'Unable to connect to the quiz server.'
        });
    }

    let result;

    try {
        result = await response.json();
    } catch {
        throw new ApiError({
            status: 500,
            code: 'INVALID_RESPONSE',
            message: 'The server returned an invalid response.'
        });
    }

    if (!response.ok) {
        let code = 'QUIZ_RETRIEVAL_FAILED';

        if (response.status === 401) code = 'UNAUTHORIZED';
        if (response.status === 403) code = 'FORBIDDEN';
        if (response.status === 404) code = 'QUIZ_NOT_FOUND';

        throw new ApiError({
            status: response.status,
            code,
            message: result?.error || 'Unable to retrieve this quiz.'
        });
    }

    if (!result?.quiz) {
        throw new ApiError({
            status: 500,
            code: 'INVALID_RESPONSE',
            message: 'The server did not return the quiz.'
        });
    }

    return quizFromApi(result);
}

async function updateQuiz(id, changes, { version }) {
    const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

    const session = sessionData?.session;

    if (sessionError || !session?.access_token) {
        throw new ApiError({
            status: 401,
            code: 'UNAUTHENTICATED',
            message: 'Please sign in again.'
        });
    }

    const url =
        `${supabase.supabaseUrl}/functions/v1/quiz-admin-update` +
        `?id=${encodeURIComponent(id)}`;

    let response;

    try {
        response = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'apikey': supabase.supabaseKey,
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify(quizPatchToApi(changes, version))
        });
    } catch {
        throw new ApiError({
            status: 503,
            code: 'NETWORK_ERROR',
            message: 'Unable to connect to the quiz server.'
        });
    }

    let result;

    try {
        result = await response.json();
    } catch {
        throw new ApiError({
            status: 500,
            code: 'INVALID_RESPONSE',
            message: 'The server returned an invalid response.'
        });
    }

    if (!response.ok) {
        let code = 'QUIZ_UPDATE_FAILED';

        if (response.status === 401) code = 'UNAUTHORIZED';
        if (response.status === 403) code = 'FORBIDDEN';
        if (response.status === 404) code = 'QUIZ_NOT_FOUND';
        if (response.status === 409) code = 'VERSION_CONFLICT';
        if (response.status === 400) code = 'VALIDATION_ERROR';

        throw new ApiError({
            status: response.status,
            code,
            message: result?.error || 'Unable to save quiz changes.'
        });
    }

    if (!result?.quiz) {
        throw new ApiError({
            status: 500,
            code: 'INVALID_RESPONSE',
            message: 'The server did not return the updated quiz.'
        });
    }

    return quizFromApi(result);
}


async function createQuestion(quizId, question, { version, position }) {
    const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

    const session = sessionData?.session;

    if (sessionError || !session?.access_token) {
        throw new ApiError({
            status: 401,
            code: 'UNAUTHENTICATED',
            message: 'Please sign in again.'
        });
    }

    const url =
        `${supabase.supabaseUrl}/functions/v1/quiz-admin-create-question` +
        `?id=${encodeURIComponent(quizId)}`;

    let response;

    try {
        response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': supabase.supabaseKey,
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify(
                questionCreateToApi(question, { version, position })
            )
        });
    } catch {
        throw new ApiError({
            status: 503,
            code: 'NETWORK_ERROR',
            message: 'Unable to connect to the quiz server.'
        });
    }

    let result;

    try {
        result = await response.json();
    } catch {
        throw new ApiError({
            status: 500,
            code: 'INVALID_RESPONSE',
            message: 'The server returned an invalid response.'
        });
    }

    if (!response.ok) {
        let code = 'QUESTION_CREATION_FAILED';

        if (response.status === 401) code = 'UNAUTHORIZED';
        if (response.status === 403) code = 'FORBIDDEN';
        if (response.status === 404) code = 'QUIZ_NOT_FOUND';
        if (response.status === 409) code = 'VERSION_CONFLICT';
        if (response.status === 400) code = 'VALIDATION_ERROR';

        throw new ApiError({
            status: response.status,
            code,
            message: result?.error || 'Unable to create this question.'
        });
    }

    if (!result?.quiz) {
        throw new ApiError({
            status: 500,
            code: 'INVALID_RESPONSE',
            message: 'The server did not return the updated quiz.'
        });
    }

    return quizFromApi(result);
}

async function updateQuestion(quizId, question, { version }) {
    const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

    const session = sessionData?.session;

    if (sessionError || !session?.access_token) {
        throw new ApiError({
            status: 401,
            code: 'UNAUTHENTICATED',
            message: 'Please sign in again.'
        });
    }

    const url =
        `${supabase.supabaseUrl}/functions/v1/quiz-admin-update-question` +
        `?id=${encodeURIComponent(quizId)}`;

    let response;

    try {
        response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': supabase.supabaseKey,
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify(
                questionUpdateToApi(question, version)
            )
        });
    } catch {
        throw new ApiError({
            status: 503,
            code: 'NETWORK_ERROR',
            message: 'Unable to connect to the quiz server.'
        });
    }

    let result;

    try {
        result = await response.json();
    } catch {
        throw new ApiError({
            status: 500,
            code: 'INVALID_RESPONSE',
            message: 'The server returned an invalid response.'
        });
    }

    if (!response.ok) {
        let code = 'QUESTION_UPDATE_FAILED';

        if (response.status === 401) code = 'UNAUTHORIZED';
        if (response.status === 403) code = 'FORBIDDEN';
        if (response.status === 404) code = 'QUESTION_NOT_FOUND';
        if (response.status === 409) code = 'VERSION_CONFLICT';
        if (response.status === 400) code = 'VALIDATION_ERROR';

        throw new ApiError({
            status: response.status,
            code,
            message: result?.error || 'Unable to update this question.'
        });
    }

    if (
        result?.success !== true ||
        typeof result.version !== 'number'
    ) {
        throw new ApiError({
            status: 500,
            code: 'INVALID_RESPONSE',
            message: 'The server did not return the updated question version.'
        });
    }

    return {
        version: result.version
    };
}


async function deleteQuestion(quizId, questionId, { version }) {
    const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

    const session = sessionData?.session;

    if (sessionError || !session?.access_token) {
        throw new ApiError({
            status: 401,
            code: 'UNAUTHENTICATED',
            message: 'Please sign in again.'
        });
    }

    const url =
        `${supabase.supabaseUrl}/functions/v1/quiz-admin-delete-question` +
        `?id=${encodeURIComponent(quizId)}`;

    let response;

    try {
        response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': supabase.supabaseKey,
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({
                version,
                questionId
            })
        });
    } catch {
        throw new ApiError({
            status: 503,
            code: 'NETWORK_ERROR',
            message: 'Unable to connect to the quiz server.'
        });
    }

    let result;

    try {
        result = await response.json();
    } catch {
        throw new ApiError({
            status: 500,
            code: 'INVALID_RESPONSE',
            message: 'The server returned an invalid response.'
        });
    }

    if (!response.ok) {
        let code = 'QUESTION_DELETION_FAILED';

        if (response.status === 401) code = 'UNAUTHORIZED';
        if (response.status === 403) code = 'FORBIDDEN';
        if (response.status === 404) code = 'QUESTION_NOT_FOUND';
        if (response.status === 409) code = 'VERSION_CONFLICT';
        if (response.status === 400) code = 'VALIDATION_ERROR';

        throw new ApiError({
            status: response.status,
            code,
            message: result?.error || 'Unable to delete this question.'
        });
    }

    if (
        result?.success !== true ||
        typeof result.version !== 'number'
    ) {
        throw new ApiError({
            status: 500,
            code: 'INVALID_RESPONSE',
            message: 'The server did not confirm question deletion.'
        });
    }

    return {
        version: result.version
    };
}


async function reorderQuestions(quizId, questionIds, { version }) {
    const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

    const session = sessionData?.session;

    if (sessionError || !session?.access_token) {
        throw new ApiError({
            status: 401,
            code: 'UNAUTHENTICATED',
            message: 'Please sign in again.'
        });
    }

    const url =
        `${supabase.supabaseUrl}/functions/v1/quiz-admin-reorder-questions` +
        `?id=${encodeURIComponent(quizId)}`;

    let response;

    try {
        response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'apikey': supabase.supabaseKey,
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({
                version,
                questionIds
            })
        });
    } catch {
        throw new ApiError({
            status: 503,
            code: 'NETWORK_ERROR',
            message: 'Unable to connect to the quiz server.'
        });
    }

    let result;

    try {
        result = await response.json();
    } catch {
        throw new ApiError({
            status: 500,
            code: 'INVALID_RESPONSE',
            message: 'The server returned an invalid response.'
        });
    }

    if (!response.ok) {
        let code = 'QUESTION_REORDER_FAILED';

        if (response.status === 401) code = 'UNAUTHORIZED';
        if (response.status === 403) code = 'FORBIDDEN';
        if (response.status === 404) code = 'QUIZ_NOT_FOUND';
        if (response.status === 409) code = 'VERSION_CONFLICT';
        if (response.status === 400) code = 'VALIDATION_ERROR';

        throw new ApiError({
            status: response.status,
            code,
            message: result?.error || 'Unable to reorder questions.'
        });
    }

    if (
        result?.success !== true ||
        typeof result.version !== 'number'
    ) {
        throw new ApiError({
            status: 500,
            code: 'INVALID_RESPONSE',
            message: 'The server did not confirm the question order.'
        });
    }

    return {
        version: result.version
    };
}



export const api = {
    ...realApi,
    login,
    getMe,
    logout,
    listQuizzes,
    createQuiz,
    getQuiz,
    updateQuiz,
    createQuestion,
    updateQuestion,
    deleteQuestion,
    reorderQuestions
};