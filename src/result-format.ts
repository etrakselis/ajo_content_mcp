export function pickResponseMetadata(response: Pick<Response, 'status' | 'statusText' | 'headers'>) {
  const metadata: Record<string, string> = {
    status: String(response.status),
    statusText: response.statusText || 'OK'
  };

  for (const header of ['location', 'etag', 'x-request-id', 'content-type']) {
    const value = response.headers.get(header);
    if (value) metadata[header] = value;
  }

  return metadata;
}

export function formatSuccessResult(response: Pick<Response, 'status' | 'statusText' | 'headers'>, data: unknown) {
  const metadata = pickResponseMetadata(response);
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        ok: true,
        status: response.status,
        statusText: response.statusText,
        headers: metadata,
        data
      }, null, 2)
    }]
  };
}
