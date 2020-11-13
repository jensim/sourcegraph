package secret

import (
	"crypto/rand"
	"encoding/base64"
	"io/ioutil"
	"os"
	"strings"
	"sync"

	"github.com/inconshreveable/log15"
	"github.com/pkg/errors"

	"github.com/sourcegraph/sourcegraph/internal/conf"
)

// gatherKeys splits the comma-separated encryption data into its potential two components:
// primary and secondary keys, where the first key is assumed to be the primary key.
// Each key is expected to be base64-encoded separately.
func gatherKeys(data []byte) (primaryKey, secondaryKey []byte, err error) {
	parts := strings.Split(string(data), ",")
	if len(parts) > 2 {
		return nil, nil, errors.Errorf("expect at most two encryption keys but got %d", len(parts))
	}

	primaryKey, err = base64.StdEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, nil, errors.Wrap(err, "decode primary key")
	} else if len(primaryKey) < requiredKeyLength {
		return nil, nil, errors.Errorf("primary key length of %d bytes is required", requiredKeyLength)
	}

	if len(parts) == 2 {
		secondaryKey, err = base64.StdEncoding.DecodeString(parts[1])
		if err != nil {
			return nil, nil, errors.Wrap(err, "decode secondary key")
		} else if len(primaryKey) < requiredKeyLength {
			return nil, nil, errors.Errorf("secondary key length of %d bytes is required", requiredKeyLength)
		}
	}

	return primaryKey, secondaryKey, nil
}

var initErr error
var initOnce sync.Once

// Init creates the defaultEncryptor by ingesting user encryption key(s).
// For production deployments, the secret value CAN ONLY be generated by the user and loaded via a file or env var.
// For single server docker deployments, we will generate the secret file and write it to disk.
func Init() error {
	initOnce.Do(func() {
		initErr = initDefaultEncryptor()
	})
	return initErr
}

// defaultEncryptor is configured during init, if no keys are provided it will implement noOpEncryptor.
var defaultEncryptor encryptor = noOpEncryptor{}

// NOTE: MockDefaultEncryptor should only be called in tests where a random encryptor is
// needed to test transparent encryption and decryption.
func MockDefaultEncryptor() {
	defaultEncryptor = newAESGCMEncodedEncryptor(mustGenerateRandomAESKey(), nil)
}

const sourcegraphSecretFile = "SOURCEGRAPH_SECRET_FILE"

func initDefaultEncryptor() error {
	// NOTE: Previously in 3.20, we auto-generated this file for single-image instances.
	// Now we clean this up and it is OK to do this on every start as we haven't advertised
	// the secrets encryption feature to any customer.
	// TODO(jchen): Delete this once 3.22 is released.
	if conf.IsDeployTypeSingleDockerContainer(conf.DeployType()) {
		_ = os.Remove("/var/lib/sourcegraph/token")
	}

	secretFile := os.Getenv(sourcegraphSecretFile)
	if secretFile == "" {
		defaultEncryptor = noOpEncryptor{}
		log15.Warn("No encryption initialized")
		return nil
	}

	fileInfo, err := os.Stat(secretFile)
	if err != nil {
		return errors.Wrapf(err, "stat file %q", secretFile)
	}

	perm := fileInfo.Mode().Perm()
	if perm != os.FileMode(0400) {
		return errors.New("key file permissions are not 0400")
	}

	encryptionKeys, err := ioutil.ReadFile(secretFile)
	if err != nil {
		return errors.Wrapf(err, "read file %q", secretFile)
	}

	primaryKey, secondaryKey, err := gatherKeys(encryptionKeys)
	if err != nil {
		return errors.Wrap(err, "gather keys")
	}

	defaultEncryptor = newAESGCMEncodedEncryptor(primaryKey, secondaryKey)
	log15.Info("Database secrets encryption initialized")
	return nil
}

// generateRandomAESKey generates a random key that can be used for AES-256 encryption.
func generateRandomAESKey() ([]byte, error) {
	b := make([]byte, requiredKeyLength)
	_, err := rand.Read(b)
	if err != nil {
		return nil, err
	}
	return b, nil
}

// mustGenerateRandomAESKey generates a random AES key and panics for any error.
func mustGenerateRandomAESKey() []byte {
	key, err := generateRandomAESKey()
	if err != nil {
		panic(err)
	}
	return key
}
