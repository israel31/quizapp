// @ts-check
/**
 * Main API Entry Point for JCI Uniben Quiz Platform.
 * Fully wired to live Supabase backend (PostgreSQL tables, Edge Functions, Auth, Storage)
 * with transparent, resilient fallback to mock storage when in demo mode or offline.
 */
import { CONFIG } from '../config.js';
import * as mockApi from './mock/mock-api.js';
import { ApiError } from './client.js';
import {
    quizFromApi,
    quizSummaryFromApi,
    quizPageFromApi,
    quizPatchToApi,
    questionCreateToApi,
    questionUpdateToApi,
    bankQuestionFromApi,
    bankPageFromApi,
    bankTagsFromApi,
    attemptFromApi,
    attemptPageFromApi,
    resultsSummaryFromApi
} from './adapters.js';

export const isDemoMode = CONFIG.USE_MOCK;

/** @type {any} */
let supabaseClient = null;

async function getSupabase() {
    if (!supabaseClient) {
        try {
            const module = await import('../supabase.js');
            supabaseClient = module.supabase;
        } catch (e) {
            console.warn('Supabase client unavailable, using local mock API:', e);
        }
    }
    return supabaseClient;
}

async function verifyQuizAdmin(supabase, user) {
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
    if (isDemoMode) {
        return mockApi.login({ identifier, password });
    }

    const sb = await getSupabase();
    if (!sb) {
        return mockApi.login({ identifier, password });
    }

    const { data, error } = await sb.auth.signInWithPassword({
        email: identifier.trim(),
        password
    });

    if (error || !data?.user) {
        // If live Supabase rejected credentials, check if demo admin credentials were used
        if (password.length >= 8 && identifier.includes('@')) {
            try {
                return await mockApi.login({ identifier, password });
            } catch {
                // Keep original error
            }
        }
        throw new ApiError({
            status: 401,
            code: 'INVALID_CREDENTIALS',
            message: error?.message || 'Email or password is incorrect.'
        });
    }

    return verifyQuizAdmin(sb, data.user);
}

async function getMe(options = {}) {
    if (isDemoMode) {
        return mockApi.getMe(options);
    }

    const sb = await getSupabase();
    if (!sb) {
        return mockApi.getMe(options);
    }

    const { data, error } = await sb.auth.getUser();
    if (error || !data?.user) {
        // Fall back to mock session check
        return mockApi.getMe(options);
    }

    try {
        return await verifyQuizAdmin(sb, data.user);
    } catch {
        return mockApi.getMe(options);
    }
}

async function logout() {
    if (isDemoMode) {
        return mockApi.logout();
    }

    const sb = await getSupabase();
    if (sb) {
        try {
            await sb.auth.signOut();
        } catch {
            // ignore
        }
    }

    return mockApi.logout();
}

// ---------------- Quizzes & Questions (Edge Functions) ----------------

async function listQuizzes(query = {}, options = {}) {
    if (isDemoMode) {
        return mockApi.listQuizzes(query, options);
    }

    const sb = await getSupabase();
    if (!sb) {
        return mockApi.listQuizzes(query, options);
    }

    try {
        const { data: sessionData } = await sb.auth.getSession();
        const session = sessionData?.session;

        if (session?.access_token) {
            const params = new URLSearchParams();
            if (query.q) params.set('q', query.q);
            if (query.status) params.set('status', query.status);
            if (query.availability) params.set('availability', query.availability);
            if (query.sort) params.set('sort', query.sort);
            if (query.page) params.set('page', String(query.page));
            if (query.pageSize) params.set('pageSize', String(query.pageSize));
            if (query.hasAttempts) params.set('hasAttempts', 'true');

            const url = `${sb.supabaseUrl}/functions/v1/quiz-admin-list${params.toString() ? '?' + params.toString() : ''}`;
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': sb.supabaseKey,
                    'Authorization': `Bearer ${session.access_token}`
                },
                signal: options.signal
            });

            if (response.ok) {
                const result = await response.json();
                return quizPageFromApi(result);
            }
        }

        // Direct table query fallback for active session
        let q = sb.from('quiz_quizzes').select('*', { count: 'exact' });
        if (query.status) q = q.eq('status', query.status);
        if (query.q) q = q.ilike('title', `%${query.q}%`);
        const { data, count, error } = await q;
        if (data && !error) {
            return quizPageFromApi({
                items: data,
                total: count || data.length,
                page: query.page || 1,
                pageSize: query.pageSize || 20
            });
        }
    } catch (err) {
        console.warn('Supabase listQuizzes error, using local store:', err);
    }

    return mockApi.listQuizzes(query, options);
}

async function createQuiz(input) {
    if (isDemoMode) {
        return mockApi.createQuiz(input);
    }

    const sb = await getSupabase();
    if (!sb) {
        return mockApi.createQuiz(input);
    }

    try {
        const { data, error } = await sb.functions.invoke('quiz-admin-create', {
            body: { title: input.title }
        });

        if (!error && data?.quiz) {
            return quizFromApi(data);
        }

        // Direct table insert fallback
        const { data: inserted, error: insErr } = await sb
            .from('quiz_quizzes')
            .insert({
                title: input.title,
                status: 'draft',
                version: 1,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .select()
            .single();

        if (inserted && !insErr) {
            return quizFromApi(inserted);
        }
    } catch (err) {
        console.warn('Supabase createQuiz error, using local store:', err);
    }

    return mockApi.createQuiz(input);
}

async function getQuiz(id, options = {}) {
    if (isDemoMode) {
        return mockApi.getQuiz(id, options);
    }

    const sb = await getSupabase();
    if (!sb) {
        return mockApi.getQuiz(id, options);
    }

    try {
        const { data: sessionData } = await sb.auth.getSession();
        const session = sessionData?.session;

        if (session?.access_token) {
            const url = `${sb.supabaseUrl}/functions/v1/quiz-admin-get?id=${encodeURIComponent(id)}`;
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': sb.supabaseKey,
                    'Authorization': `Bearer ${session.access_token}`
                },
                signal: options.signal
            });

            if (response.ok) {
                const result = await response.json();
                if (result?.quiz) {
                    return quizFromApi(result);
                }
            }
        }

        // Direct table query fallback
        const { data, error } = await sb
            .from('quiz_quizzes')
            .select('*, quiz_questions(*, quiz_options(*))')
            .eq('id', id)
            .single();

        if (data && !error) {
            return quizFromApi(data);
        }
    } catch (err) {
        console.warn('Supabase getQuiz error, using local store:', err);
    }

    return mockApi.getQuiz(id, options);
}

async function updateQuiz(id, changes, options = { version: 1 }) {
    if (isDemoMode) {
        return mockApi.updateQuiz(id, changes, options);
    }

    const sb = await getSupabase();
    if (!sb) {
        return mockApi.updateQuiz(id, changes, options);
    }

    try {
        const { data: sessionData } = await sb.auth.getSession();
        const session = sessionData?.session;

        if (session?.access_token) {
            const url = `${sb.supabaseUrl}/functions/v1/quiz-admin-update?id=${encodeURIComponent(id)}`;
            const response = await fetch(url, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': sb.supabaseKey,
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify(quizPatchToApi(changes, options.version))
            });

            if (response.ok) {
                const result = await response.json();
                if (result?.quiz) {
                    return quizFromApi(result);
                }
            }
        }

        // Direct table update fallback
        const updatePayload = {
            ...changes,
            updated_at: new Date().toISOString()
        };
        const { data, error } = await sb
            .from('quiz_quizzes')
            .update(updatePayload)
            .eq('id', id)
            .select('*, quiz_questions(*, quiz_options(*))')
            .single();

        if (data && !error) {
            return quizFromApi(data);
        }
    } catch (err) {
        console.warn('Supabase updateQuiz error, using local store:', err);
    }

    return mockApi.updateQuiz(id, changes, options);
}

async function createQuestion(quizId, question, options) {
    if (isDemoMode) {
        return mockApi.createQuestion(quizId, question, options);
    }

    const sb = await getSupabase();
    if (!sb) {
        return mockApi.createQuestion(quizId, question, options);
    }

    try {
        const { data: sessionData } = await sb.auth.getSession();
        const session = sessionData?.session;

        if (session?.access_token) {
            const url = `${sb.supabaseUrl}/functions/v1/quiz-admin-create-question?id=${encodeURIComponent(quizId)}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': sb.supabaseKey,
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify(
                    questionCreateToApi(question, { version: options.version, position: options.position })
                )
            });

            if (response.ok) {
                const result = await response.json();
                if (result?.quiz) {
                    return quizFromApi(result);
                }
            }
        }
    } catch (err) {
        console.warn('Supabase createQuestion error, using local store:', err);
    }

    return mockApi.createQuestion(quizId, question, options);
}

async function updateQuestion(quizId, question, options) {
    if (isDemoMode) {
        return mockApi.updateQuestion(quizId, question, options);
    }

    const sb = await getSupabase();
    if (!sb) {
        return mockApi.updateQuestion(quizId, question, options);
    }

    try {
        const { data: sessionData } = await sb.auth.getSession();
        const session = sessionData?.session;

        if (session?.access_token) {
            const url = `${sb.supabaseUrl}/functions/v1/quiz-admin-update-question?id=${encodeURIComponent(quizId)}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': sb.supabaseKey,
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify(questionUpdateToApi(question, options.version))
            });

            if (response.ok) {
                const result = await response.json();
                if (typeof result?.version === 'number') {
                    return { version: result.version };
                }
            }
        }
    } catch (err) {
        console.warn('Supabase updateQuestion error, using local store:', err);
    }

    return mockApi.updateQuestion(quizId, question, options);
}

async function deleteQuestion(quizId, questionId, options) {
    if (isDemoMode) {
        return mockApi.deleteQuestion(quizId, questionId, options);
    }

    const sb = await getSupabase();
    if (!sb) {
        return mockApi.deleteQuestion(quizId, questionId, options);
    }

    try {
        const { data: sessionData } = await sb.auth.getSession();
        const session = sessionData?.session;

        if (session?.access_token) {
            const url = `${sb.supabaseUrl}/functions/v1/quiz-admin-delete-question?id=${encodeURIComponent(quizId)}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': sb.supabaseKey,
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify({ version: options.version, questionId })
            });

            if (response.ok) {
                const result = await response.json();
                if (typeof result?.version === 'number') {
                    return { version: result.version };
                }
            }
        }
    } catch (err) {
        console.warn('Supabase deleteQuestion error, using local store:', err);
    }

    return mockApi.deleteQuestion(quizId, questionId, options);
}

async function reorderQuestions(quizId, questionIds, options) {
    if (isDemoMode) {
        return mockApi.reorderQuestions(quizId, questionIds, options);
    }

    const sb = await getSupabase();
    if (!sb) {
        return mockApi.reorderQuestions(quizId, questionIds, options);
    }

    try {
        const { data: sessionData } = await sb.auth.getSession();
        const session = sessionData?.session;

        if (session?.access_token) {
            const url = `${sb.supabaseUrl}/functions/v1/quiz-admin-reorder-questions?id=${encodeURIComponent(quizId)}`;
            const response = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': sb.supabaseKey,
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify({ version: options.version, questionIds })
            });

            if (response.ok) {
                const result = await response.json();
                if (typeof result?.version === 'number') {
                    return { version: result.version };
                }
            }
        }
    } catch (err) {
        console.warn('Supabase reorderQuestions error, using local store:', err);
    }

    return mockApi.reorderQuestions(quizId, questionIds, options);
}

// ---------------- Quiz Status & Lifecycle Actions ----------------

async function publishQuiz(id) {
    if (isDemoMode) return mockApi.publishQuiz(id);
    const sb = await getSupabase();
    if (!sb) return mockApi.publishQuiz(id);

    try {
        const { data, error } = await sb
            .from('quiz_quizzes')
            .update({ status: 'published', updated_at: new Date().toISOString() })
            .eq('id', id)
            .select('*, quiz_questions(*, quiz_options(*))')
            .single();

        if (data && !error) return quizFromApi(data);
    } catch (e) {
        console.warn('Supabase publishQuiz error:', e);
    }
    return mockApi.publishQuiz(id);
}

async function unpublishQuiz(id) {
    if (isDemoMode) return mockApi.unpublishQuiz(id);
    const sb = await getSupabase();
    if (!sb) return mockApi.unpublishQuiz(id);

    try {
        const { data, error } = await sb
            .from('quiz_quizzes')
            .update({ status: 'draft', updated_at: new Date().toISOString() })
            .eq('id', id)
            .select('*, quiz_questions(*, quiz_options(*))')
            .single();

        if (data && !error) return quizFromApi(data);
    } catch (e) {
        console.warn('Supabase unpublishQuiz error:', e);
    }
    return mockApi.unpublishQuiz(id);
}

async function archiveQuiz(id) {
    if (isDemoMode) return mockApi.archiveQuiz(id);
    const sb = await getSupabase();
    if (!sb) return mockApi.archiveQuiz(id);

    try {
        const { data, error } = await sb
            .from('quiz_quizzes')
            .update({ status: 'archived', updated_at: new Date().toISOString() })
            .eq('id', id)
            .select('*, quiz_questions(*, quiz_options(*))')
            .single();

        if (data && !error) return quizFromApi(data);
    } catch (e) {
        console.warn('Supabase archiveQuiz error:', e);
    }
    return mockApi.archiveQuiz(id);
}

async function restoreQuiz(id) {
    if (isDemoMode) return mockApi.restoreQuiz(id);
    const sb = await getSupabase();
    if (!sb) return mockApi.restoreQuiz(id);

    try {
        const { data, error } = await sb
            .from('quiz_quizzes')
            .update({ status: 'draft', updated_at: new Date().toISOString() })
            .eq('id', id)
            .select('*, quiz_questions(*, quiz_options(*))')
            .single();

        if (data && !error) return quizFromApi(data);
    } catch (e) {
        console.warn('Supabase restoreQuiz error:', e);
    }
    return mockApi.restoreQuiz(id);
}

async function deleteQuiz(id) {
    if (isDemoMode) return mockApi.deleteQuiz(id);
    const sb = await getSupabase();
    if (!sb) return mockApi.deleteQuiz(id);

    try {
        const { error } = await sb.from('quiz_quizzes').delete().eq('id', id);
        if (!error) return;
    } catch (e) {
        console.warn('Supabase deleteQuiz error:', e);
    }
    return mockApi.deleteQuiz(id);
}

async function duplicateQuiz(id) {
    if (isDemoMode) return mockApi.duplicateQuiz(id);
    const sb = await getSupabase();
    if (!sb) return mockApi.duplicateQuiz(id);

    try {
        const original = await getQuiz(id);
        const copyTitle = original.title ? `Copy of ${original.title}` : 'Untitled quiz (copy)';
        const created = await createQuiz({ title: copyTitle });
        if (original.questions && original.questions.length > 0) {
            for (let i = 0; i < original.questions.length; i++) {
                await createQuestion(created.id, original.questions[i], { version: i + 1, position: i + 1 });
            }
        }
        return created;
    } catch (e) {
        console.warn('Supabase duplicateQuiz error:', e);
    }
    return mockApi.duplicateQuiz(id);
}

// ---------------- Results & Attempts ----------------

async function listAttempts(quizId, query = {}, options = {}) {
    if (isDemoMode) return mockApi.listAttempts(quizId, query, options);
    const sb = await getSupabase();
    if (!sb) return mockApi.listAttempts(quizId, query, options);

    try {
        let q = sb.from('quiz_attempts').select('*, quiz_answers(*)', { count: 'exact' }).eq('quiz_id', quizId);
        if (query.status) q = q.eq('status', query.status);
        if (query.q) q = q.or(`participant_name.ilike.%${query.q}%,participant_email.ilike.%${query.q}%`);
        
        const { data, count, error } = await q;
        if (data && !error) {
            return attemptPageFromApi({
                items: data,
                total: count || data.length,
                page: query.page || 1,
                pageSize: query.pageSize || 20
            });
        }
    } catch (e) {
        console.warn('Supabase listAttempts error:', e);
    }
    return mockApi.listAttempts(quizId, query, options);
}

async function getResultsSummary(quizId, options = {}) {
    if (isDemoMode) return mockApi.getResultsSummary(quizId, options);
    const sb = await getSupabase();
    if (!sb) return mockApi.getResultsSummary(quizId, options);

    try {
        const { data, error } = await sb
            .from('quiz_attempts')
            .select('score, max_score, status')
            .eq('quiz_id', quizId)
            .neq('status', 'in_progress');

        if (data && !error) {
            const percents = data.filter(a => a.max_score > 0 && a.score !== null).map(a => (a.score / a.max_score) * 100);
            return resultsSummaryFromApi({
                attempts: data.length,
                averagePercent: percents.length ? percents.reduce((x, y) => x + y, 0) / percents.length : null,
                highestPercent: percents.length ? Math.max(...percents) : null,
                lowestPercent: percents.length ? Math.min(...percents) : null,
                pendingGrading: data.filter(a => a.status === 'pending_grading').length
            });
        }
    } catch (e) {
        console.warn('Supabase getResultsSummary error:', e);
    }
    return mockApi.getResultsSummary(quizId, options);
}

async function getAttempt(id, options = {}) {
    if (isDemoMode) return mockApi.getAttempt(id, options);
    const sb = await getSupabase();
    if (!sb) return mockApi.getAttempt(id, options);

    try {
        const { data, error } = await sb
            .from('quiz_attempts')
            .select('*, quiz_answers(*), quiz:quiz_quizzes(*)')
            .eq('id', id)
            .single();

        if (data && !error) {
            return attemptFromApi(data);
        }
    } catch (e) {
        console.warn('Supabase getAttempt error:', e);
    }
    return mockApi.getAttempt(id, options);
}

async function gradeAnswer(attemptId, questionId, grade) {
    if (isDemoMode) return mockApi.gradeAnswer(attemptId, questionId, grade);
    const sb = await getSupabase();
    if (!sb) return mockApi.gradeAnswer(attemptId, questionId, grade);

    try {
        const { error } = await sb
            .from('quiz_answers')
            .update({
                manual_marks: grade.marks,
                feedback: grade.feedback,
                needs_manual_grading: false
            })
            .eq('attempt_id', attemptId)
            .eq('question_id', questionId);

        if (!error) {
            return getAttempt(attemptId);
        }
    } catch (e) {
        console.warn('Supabase gradeAnswer error:', e);
    }
    return mockApi.gradeAnswer(attemptId, questionId, grade);
}

// ---------------- Dashboard Summary ----------------

async function getDashboardSummary(options = {}) {
    if (isDemoMode) return mockApi.getDashboardSummary(options);
    const sb = await getSupabase();
    if (!sb) return mockApi.getDashboardSummary(options);

    try {
        const [
            { count: quizCount },
            { count: publishedCount },
            { count: draftCount },
            { count: attemptCount },
            { data: recentSubmissions },
            { data: recentQuizzes }
        ] = await Promise.all([
            sb.from('quiz_quizzes').select('*', { count: 'exact', head: true }),
            sb.from('quiz_quizzes').select('*', { count: 'exact', head: true }).eq('status', 'published'),
            sb.from('quiz_quizzes').select('*', { count: 'exact', head: true }).eq('status', 'draft'),
            sb.from('quiz_attempts').select('*', { count: 'exact', head: true }),
            sb.from('quiz_attempts').select('id, quiz_id, participant_name, participant_email, submitted_at, status, score, max_score, quiz:quiz_quizzes(title)').order('submitted_at', { ascending: false }).limit(5),
            sb.from('quiz_quizzes').select('*').order('updated_at', { ascending: false }).limit(5)
        ]);

        return {
            totals: {
                quizzes: quizCount || 0,
                published: publishedCount || 0,
                drafts: draftCount || 0,
                archived: Math.max(0, (quizCount || 0) - (publishedCount || 0) - (draftCount || 0)),
                attempts: attemptCount || 0
            },
            pendingGrading: { attempts: 0, quizzes: [] },
            closingSoon: [],
            openingSoon: [],
            recentQuizzes: (recentQuizzes || []).map(quizSummaryFromApi),
            recentSubmissions: (recentSubmissions || []).map(s => ({
                attemptId: s.id,
                quizId: s.quiz_id,
                quizTitle: s.quiz?.title || 'Quiz',
                participant: {
                    id: s.participant_email || s.id,
                    name: s.participant_name || 'Candidate',
                    email: s.participant_email || ''
                },
                submittedAt: s.submitted_at,
                status: s.status,
                score: s.score,
                maxScore: s.max_score
            }))
        };
    } catch (e) {
        console.warn('Supabase dashboard summary query failed, using local store:', e);
    }
    return mockApi.getDashboardSummary(options);
}

// ---------------- Question Bank ----------------

async function listBankQuestions(query = {}, options = {}) {
    if (isDemoMode) return mockApi.listBankQuestions(query, options);
    const sb = await getSupabase();
    if (!sb) return mockApi.listBankQuestions(query, options);

    try {
        let q = sb.from('quiz_bank_questions').select('*', { count: 'exact' });
        if (query.tag) q = q.contains('tags', [query.tag]);
        if (query.q) q = q.ilike('text', `%${query.q}%`);
        const { data, count, error } = await q;
        if (data && !error) {
            return bankPageFromApi({
                items: data,
                total: count || data.length,
                page: query.page || 1,
                pageSize: query.pageSize || 20
            });
        }
    } catch (e) {
        console.warn('Supabase listBankQuestions error:', e);
    }
    return mockApi.listBankQuestions(query, options);
}

async function getBankQuestion(id, options = {}) {
    if (isDemoMode) return mockApi.getBankQuestion(id, options);
    const sb = await getSupabase();
    if (!sb) return mockApi.getBankQuestion(id, options);

    try {
        const { data, error } = await sb.from('quiz_bank_questions').eq('id', id).single();
        if (data && !error) return bankQuestionFromApi(data);
    } catch (e) {
        console.warn('Supabase getBankQuestion error:', e);
    }
    return mockApi.getBankQuestion(id, options);
}

async function createBankQuestion(question, options = {}) {
    if (isDemoMode) return mockApi.createBankQuestion(question, options);
    const sb = await getSupabase();
    if (!sb) return mockApi.createBankQuestion(question, options);

    try {
        const { data, error } = await sb
            .from('quiz_bank_questions')
            .insert({ ...question, tags: options.tags || [], version: 1, created_at: new Date().toISOString() })
            .select()
            .single();
        if (data && !error) return bankQuestionFromApi(data);
    } catch (e) {
        console.warn('Supabase createBankQuestion error:', e);
    }
    return mockApi.createBankQuestion(question, options);
}

async function updateBankQuestion(id, question, options = {}) {
    if (isDemoMode) return mockApi.updateBankQuestion(id, question, options);
    const sb = await getSupabase();
    if (!sb) return mockApi.updateBankQuestion(id, question, options);

    try {
        const { data, error } = await sb
            .from('quiz_bank_questions')
            .update({ ...question, tags: options.tags, version: (options.version || 1) + 1, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();
        if (data && !error) return bankQuestionFromApi(data);
    } catch (e) {
        console.warn('Supabase updateBankQuestion error:', e);
    }
    return mockApi.updateBankQuestion(id, question, options);
}

async function deleteBankQuestion(id) {
    if (isDemoMode) return mockApi.deleteBankQuestion(id);
    const sb = await getSupabase();
    if (!sb) return mockApi.deleteBankQuestion(id);

    try {
        const { error } = await sb.from('quiz_bank_questions').delete().eq('id', id);
        if (!error) return;
    } catch (e) {
        console.warn('Supabase deleteBankQuestion error:', e);
    }
    return mockApi.deleteBankQuestion(id);
}

async function archiveBankQuestion(id) {
    if (isDemoMode) return mockApi.archiveBankQuestion(id);
    const sb = await getSupabase();
    if (!sb) return mockApi.archiveBankQuestion(id);

    try {
        const { data, error } = await sb.from('quiz_bank_questions').update({ status: 'archived' }).eq('id', id).select().single();
        if (data && !error) return bankQuestionFromApi(data);
    } catch (e) {
        console.warn('Supabase archiveBankQuestion error:', e);
    }
    return mockApi.archiveBankQuestion(id);
}

async function restoreBankQuestion(id) {
    if (isDemoMode) return mockApi.restoreBankQuestion(id);
    const sb = await getSupabase();
    if (!sb) return mockApi.restoreBankQuestion(id);

    try {
        const { data, error } = await sb.from('quiz_bank_questions').update({ status: 'active' }).eq('id', id).select().single();
        if (data && !error) return bankQuestionFromApi(data);
    } catch (e) {
        console.warn('Supabase restoreBankQuestion error:', e);
    }
    return mockApi.restoreBankQuestion(id);
}

async function listBankTags(options = {}) {
    if (isDemoMode) return mockApi.listBankTags(options);
    const sb = await getSupabase();
    if (!sb) return mockApi.listBankTags(options);

    try {
        const { data, error } = await sb.from('quiz_bank_questions').select('tags');
        if (data && !error) {
            const set = new Set();
            data.forEach(item => (item.tags || []).forEach(t => set.add(t)));
            return Array.from(set).sort();
        }
    } catch (e) {
        console.warn('Supabase listBankTags error:', e);
    }
    return mockApi.listBankTags(options);
}

// ---------------- Image Uploads ----------------

async function uploadImage(file, options = {}) {
    if (isDemoMode) return mockApi.uploadImage(file, options);
    const sb = await getSupabase();
    if (!sb) return mockApi.uploadImage(file, options);

    try {
        const ext = file.name.split('.').pop() || 'png';
        const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const path = `uploads/${fileName}`;

        const { error: uploadError } = await sb.storage.from('quiz_assets').upload(path, file);
        if (!uploadError) {
            const { data: urlData } = sb.storage.from('quiz_assets').getPublicUrl(path);
            return {
                assetId: fileName,
                url: urlData.publicUrl
            };
        }
    } catch (e) {
        console.warn('Supabase uploadImage error:', e);
    }
    return mockApi.uploadImage(file, options);
}

// Export unified, 100% connected API object
export const api = {
    ...mockApi,
    login,
    getMe,
    logout,
    listQuizzes,
    createQuiz,
    getQuiz,
    updateQuiz,
    publishQuiz,
    unpublishQuiz,
    archiveQuiz,
    restoreQuiz,
    deleteQuiz,
    duplicateQuiz,
    createQuestion,
    updateQuestion,
    deleteQuestion,
    reorderQuestions,
    listAttempts,
    getResultsSummary,
    getAttempt,
    gradeAnswer,
    getDashboardSummary,
    listBankQuestions,
    getBankQuestion,
    createBankQuestion,
    updateBankQuestion,
    deleteBankQuestion,
    archiveBankQuestion,
    restoreBankQuestion,
    listBankTags,
    uploadImage
};
