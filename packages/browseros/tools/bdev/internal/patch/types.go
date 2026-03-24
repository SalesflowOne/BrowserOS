package patch

type Op string

const (
	OpPatch   Op = "patch"
	OpDeleted Op = "deleted"
)

type FilePatch struct {
	Path    string
	Op      Op
	Content []byte
}
