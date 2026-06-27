package raw

import (
	"encoding/json"
	"fmt"
	"strings"

	"browseros-cli/mcp"
)

// Client is the small MCP surface the raw tier needs.
type Client interface {
	CallTool(name string, args map[string]any) (*mcp.ToolResult, error)
}

// Deps keeps this package independent from package cmd.
type Deps struct {
	NewClient     func() Client
	ResolvePageID func() (int, error)
	JSONOutput    func() bool
}

type commandError struct {
	code int
	err  error
}

func (e commandError) Error() string { return e.err.Error() }
func (e commandError) Unwrap() error { return e.err }
func (e commandError) Code() int     { return e.code }

type codedError interface {
	Code() int
}

type runEnvelope struct {
	OK    bool
	Value any
	Logs  []string
	Error string
}

func executeCDP(deps Deps, method string, rawParams string) (*mcp.ToolResult, error) {
	method = strings.TrimSpace(method)
	if method == "" {
		return nil, commandError{code: 3, err: fmt.Errorf("CDP method is required")}
	}

	params, err := parseParams(rawParams)
	if err != nil {
		return nil, commandError{code: 3, err: err}
	}

	if deps.ResolvePageID == nil {
		return nil, commandError{code: 2, err: fmt.Errorf("page resolver is not configured")}
	}
	pageID, err := deps.ResolvePageID()
	if err != nil {
		return nil, commandError{code: 2, err: err}
	}

	if deps.NewClient == nil {
		return nil, commandError{code: 1, err: fmt.Errorf("MCP client is not configured")}
	}
	return callCDP(deps.NewClient(), pageID, method, params)
}

func parseParams(raw string) (any, error) {
	var params any
	if err := json.Unmarshal([]byte(raw), &params); err != nil {
		return nil, fmt.Errorf("invalid JSON params: %w", err)
	}
	return params, nil
}

func callCDP(c Client, pageID int, method string, params any) (*mcp.ToolResult, error) {
	env, err := runJS(c, cdpScript(pageID, method, params))
	if err != nil {
		return nil, commandError{code: 1, err: err}
	}
	return cdpToolResult(pageID, method, env), nil
}

func runJS(c Client, code string) (runEnvelope, error) {
	result, callErr := c.CallTool("run", map[string]any{"code": code})
	if result == nil {
		if callErr != nil {
			return runEnvelope{}, callErr
		}
		return runEnvelope{}, fmt.Errorf("run returned no result")
	}

	env, parseErr := parseRunEnvelope(result)
	if parseErr != nil {
		if callErr != nil {
			return runEnvelope{}, callErr
		}
		return runEnvelope{}, parseErr
	}

	if !env.OK {
		if env.Error != "" {
			return env, fmt.Errorf("%s", env.Error)
		}
		if callErr != nil {
			return env, callErr
		}
		text := strings.TrimSpace(result.TextContent())
		if text == "" {
			text = "run failed"
		}
		return env, fmt.Errorf("%s", text)
	}

	if callErr != nil {
		return env, callErr
	}
	return env, nil
}

func parseRunEnvelope(result *mcp.ToolResult) (runEnvelope, error) {
	if result == nil || result.StructuredContent == nil {
		return runEnvelope{}, fmt.Errorf("run did not return structured content")
	}

	ok, okSet := result.StructuredContent["ok"].(bool)
	if !okSet {
		return runEnvelope{}, fmt.Errorf("run response missing ok field")
	}

	logs, err := stringSlice(result.StructuredContent["logs"])
	if err != nil {
		return runEnvelope{}, err
	}

	errorText := ""
	if rawError, exists := result.StructuredContent["error"]; exists && rawError != nil {
		s, ok := rawError.(string)
		if !ok {
			return runEnvelope{}, fmt.Errorf("run response error field is not a string")
		}
		errorText = s
	}

	return runEnvelope{
		OK:    ok,
		Value: result.StructuredContent["value"],
		Logs:  logs,
		Error: errorText,
	}, nil
}

func stringSlice(raw any) ([]string, error) {
	if raw == nil {
		return []string{}, nil
	}
	if values, ok := raw.([]string); ok {
		return append([]string(nil), values...), nil
	}
	items, ok := raw.([]any)
	if !ok {
		return nil, fmt.Errorf("run response logs field is not a string array")
	}
	logs := make([]string, 0, len(items))
	for _, item := range items {
		s, ok := item.(string)
		if !ok {
			return nil, fmt.Errorf("run response logs field contains a non-string value")
		}
		logs = append(logs, s)
	}
	return logs, nil
}

func cdpScript(pageID int, method string, params any) string {
	return fmt.Sprintf(`const pageSession = await browser.pages.getSession(%d)
const method = %s
const params = %s
const parts = method.split('.')
if (parts.length !== 2 || !parts[0] || !parts[1]) {
  throw new Error(`+"`Invalid CDP method \"${method}\"`"+`)
}
const [domain, command] = parts
const target = pageSession.session[domain]
if (!target || typeof target[command] !== 'function') {
  throw new Error(`+"`Unknown CDP method \"${method}\"`"+`)
}
return await target[command](params)`,
		pageID,
		jsLiteral(method),
		jsLiteral(params),
	)
}

func cdpToolResult(pageID int, method string, env runEnvelope) *mcp.ToolResult {
	text := "ok"
	if env.Value != nil {
		text = fmt.Sprintf("return: %s", safeStringify(env.Value))
	}
	return &mcp.ToolResult{
		Content: []mcp.ContentItem{{Type: "text", Text: text}},
		StructuredContent: map[string]any{
			"ok":     true,
			"page":   pageID,
			"method": method,
			"result": env.Value,
			"logs":   env.Logs,
		},
	}
}

func jsLiteral(v any) string {
	data, err := json.Marshal(v)
	if err != nil {
		return "null"
	}
	return string(data)
}

func safeStringify(v any) string {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return fmt.Sprint(v)
	}
	return string(data)
}
