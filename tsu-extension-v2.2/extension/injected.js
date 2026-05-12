// This script runs in the page context (main world) to leverage Whatnot's
// fetch interceptors and access page-level cookies/headers

(function () {
  // Guard against double-injection (extension reload, page nav, etc.)
  // Without this, multiple calls stack message listeners and cause duplicate events.
  if (window.__TSU_INJECTED__) return;
  window.__TSU_INJECTED__ = true;

  const GRAPHQL_URL = 'https://www.whatnot.com/services/graphql/';

  function getCookie(name) {
    const cookie = document.cookie.split(';').find(c => c.trim().startsWith(name + '='));
    return cookie ? cookie.split('=')[1] : null;
  }

  function generateRequestId() {
    return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  }

  function getWhatnotHeaders(liveId) {
    const appSessionId = getCookie('ajs_anonymous_id') || getCookie('stable-id') || crypto.randomUUID();
    const userSessionId = getCookie('usid') || crypto.randomUUID();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
    const now = new Date();
    const version = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;

    const headers = {
      'Content-Type': 'application/json',
      'Accept': '*/*',
      'authorization': 'Cookie',
      'x-client-timezone': timezone,
      'x-request-id': generateRequestId(),
      'x-whatnot-app': 'whatnot-web',
      'x-whatnot-app-context': 'next-js/browser',
      'x-whatnot-app-session-id': appSessionId,
      'x-whatnot-app-user-session-id': userSessionId,
      'x-whatnot-app-version': version,
      'x-whatnot-usgmt': ',,'
    };

    if (liveId) {
      headers['x-whatnot-livestream-id'] = liveId;
      headers['x-whatnot-app-pathname'] = `/live/${liveId}`;
      headers['x-whatnot-app-screen'] = '/live/?';
    }

    return headers;
  }

  const GRAPHQL_QUERY = `
    query LiveShopSold(
      $liveId: ID!
      $filters: [FilterInput]
      $sort: ShopSortInput
      $query: String
      $first: Int
      $after: String
    ) {
      liveShop(liveId: $liveId) {
        soldItems(
          query: $query
          filters: $filters
          sort: $sort
          first: $first
          after: $after
        ) {
          totalCount
          pageInfo {
            hasNextPage
            endCursor
            __typename
          }
          edges {
            node {
              id
              listing {
                title
                subtitle
                description
                transactionType
                pendingPayment
                price {
                  amount
                  currency
                  __typename
                }
                quantity
                listingStatus: publicStatus
                labels
                updatedAtMs
                user {
                  username
                  __typename
                }
                order {
                  id
                  __typename
                }
                product {
                  id
                  __typename
                }
                __typename
              }
              buyer {
                id
                username
                __typename
              }
              price {
                amount
                currency
                __typename
              }
              __typename
            }
            __typename
          }
          __typename
        }
        __typename
      }
      __typename
    }
  `;

  const LIVESTREAM_QUERY = `
    query LiveStreamSnapshot($id: ID!) {
      liveStream(id: $id) {
        id
        status
        title
        startTime
        activeViewers
        user {
          username
          __typename
        }
        __typename
      }
    }
  `;

  const PAGE_SIZE = 24;

  async function fetchSoldItems(liveId, after) {
    const body = JSON.stringify({
      operationName: 'LiveShopSold',
      variables: {
        after,
        filters: null,
        first: PAGE_SIZE,
        liveId,
        query: '',
        sort: null
      },
      query: GRAPHQL_QUERY
    });

    const response = await window.fetch(GRAPHQL_URL + '?operationName=LiveShopSold&ssr=0', {
      method: 'POST',
      credentials: 'include',
      headers: getWhatnotHeaders(liveId),
      body
    });

    if (!response.ok) {
      throw new Error(`GraphQL request failed (${response.status})`);
    }

    const payload = await response.json();

    if (payload?.errors?.length) {
      const [firstError] = payload.errors;
      throw new Error(firstError?.message ?? 'Unknown GraphQL error');
    }

    const soldItems = payload?.data?.liveShop?.soldItems;
    if (!soldItems) {
      return null;
    }

    return {
      totalCount: soldItems.totalCount ?? 0,
      pageInfo: {
        hasNextPage: Boolean(soldItems.pageInfo?.hasNextPage),
        endCursor: soldItems.pageInfo?.endCursor ?? null
      },
      edges: soldItems.edges ?? []
    };
  }

  async function fetchLivestreamContext(liveId) {
    const body = JSON.stringify({
      operationName: 'LiveStreamSnapshot',
      variables: { id: liveId },
      query: LIVESTREAM_QUERY
    });

    const response = await window.fetch(GRAPHQL_URL + '?operationName=LiveStreamSnapshot&ssr=0', {
      method: 'POST',
      credentials: 'include',
      headers: getWhatnotHeaders(liveId),
      body
    });

    if (!response.ok) {
      throw new Error(`GraphQL request failed (${response.status})`);
    }

    const payload = await response.json();

    if (payload?.errors?.length) {
      const [firstError] = payload.errors;
      throw new Error(firstError?.message ?? 'Unknown GraphQL error');
    }

    return payload?.data?.liveStream ?? null;
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window) {
      return;
    }

    const { type, requestId, liveId, after } = event.data || {};

    if (type === 'WHATNOT_SPY_FETCH_SOLD_ITEMS') {
      try {
        const result = await fetchSoldItems(liveId, after);
        window.postMessage({
          type: 'WHATNOT_SPY_FETCH_SOLD_ITEMS_RESULT',
          requestId,
          success: true,
          data: result
        }, '*');
      } catch (error) {
        window.postMessage({
          type: 'WHATNOT_SPY_FETCH_SOLD_ITEMS_RESULT',
          requestId,
          success: false,
          error: error.message
        }, '*');
      }
    }

    if (type === 'WHATNOT_SPY_FETCH_LIVESTREAM') {
      try {
        const result = await fetchLivestreamContext(liveId);
        window.postMessage({
          type: 'WHATNOT_SPY_FETCH_LIVESTREAM_RESULT',
          requestId,
          success: true,
          data: result
        }, '*');
      } catch (error) {
        window.postMessage({
          typ