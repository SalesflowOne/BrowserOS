package patch

import "testing"

func TestParseUnifiedDiffParsesPathAndNewFile(t *testing.T) {
	raw := []byte(`diff --git a/foo.txt b/foo.txt
new file mode 100644
index 0000000..1111111 100644
--- /dev/null
+++ b/foo.txt
@@ -0,0 +1 @@
+hello
`)

	patches, err := ParseUnifiedDiff(raw)
	if err != nil {
		t.Fatalf("ParseUnifiedDiff: %v", err)
	}
	fp := patches["foo.txt"]
	if fp == nil {
		t.Fatalf("expected foo.txt patch")
	}
	if fp.Path != "foo.txt" {
		t.Fatalf("unexpected path %q", fp.Path)
	}
	if fp.Op != OpPatch {
		t.Fatalf("unexpected op %q", fp.Op)
	}
}
